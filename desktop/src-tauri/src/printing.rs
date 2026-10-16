//! Printing from Khatario for Windows.
//!
//! The web app builds the printer bytes (ESC/POS, TSPL, ZPL — lib/print/* on the site) and hands
//! them here; this module only moves bytes, like any POS software:
//!   - Windows printers: a RAW job through the print spooler (USB thermal and label printers with
//!     their Windows driver, shared printers).
//!   - Network printers: TCP port 9100 on the shop's LAN, plus a quick scan for them.
//!   - COM ports: USB-serial printers and Bluetooth printers paired in Windows ("Standard Serial
//!     over Bluetooth link").
//!
//! Limits, because the hosted site can call these: only installed Windows printers, only private
//! LAN addresses on the raw-print ports, only COMn names, and at most 4 MB per job.

use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
use std::time::Duration;

use base64::Engine;
use serde::Serialize;

/// Largest job accepted (a long A4-width bitmap label run stays well under this).
const MAX_JOB_BYTES: usize = 4 * 1024 * 1024;
/// Ports raw network printers listen on (9100 is the JetDirect standard; some boxes use 9101–9109).
const RAW_PORTS: std::ops::RangeInclusive<u16> = 9100..=9109;
const CONNECT_TIMEOUT: Duration = Duration::from_millis(2500);
const WRITE_TIMEOUT: Duration = Duration::from_secs(15);
const SCAN_TIMEOUT: Duration = Duration::from_millis(350);

/// How a Windows printer is attached, guessed from its port name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Attachment {
    Usb,
    Network,
    Serial,
    Bluetooth,
    /// Print to PDF / XPS / OneNote / Fax: not real paper.
    Virtual,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsPrinter {
    pub name: String,
    pub port: String,
    pub driver: String,
    pub attachment: Attachment,
    pub is_default: bool,
    /// Windows marks it offline / paused / in error (USB thermal drivers often report nothing).
    pub offline: bool,
    pub paused: bool,
    pub error: bool,
}

pub fn attachment_for(name: &str, port: &str, driver: &str) -> Attachment {
    let port_up = port.to_ascii_uppercase();
    let name_up = name.to_ascii_uppercase();
    let driver_up = driver.to_ascii_uppercase();
    let is_virtual = ["PORTPROMPT:", "FILE:", "NUL:", "XPSPORT:", "SHRFAX:", "NE0"]
        .iter()
        .any(|p| port_up.starts_with(p))
        || ["PDF", "XPS", "ONENOTE", "FAX"]
            .iter()
            .any(|w| name_up.contains(w) || driver_up.contains(w));
    if is_virtual {
        Attachment::Virtual
    } else if port_up.starts_with("USB") {
        Attachment::Usb
    } else if port_up.starts_with("BTH") || port_up.contains("BLUETOOTH") {
        Attachment::Bluetooth
    } else if port_up.starts_with("COM") {
        Attachment::Serial
    } else if port_up.starts_with("IP_")
        || port_up.starts_with("WSD")
        || port_up.starts_with("\\\\")
        || port_up.parse::<Ipv4Addr>().is_ok()
    {
        Attachment::Network
    } else {
        Attachment::Other
    }
}

/// Decodes the job the page sent (base64) and checks its size.
pub fn decode_job(data: &str) -> Result<Vec<u8>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|_| "The print data was damaged. Try again.".to_string())?;
    if bytes.is_empty() {
        return Err("Nothing to print.".into());
    }
    if bytes.len() > MAX_JOB_BYTES {
        return Err("This print job is too large.".into());
    }
    Ok(bytes)
}

/// Only printers on the shop's own network: private, link-local addresses.
pub fn lan_address(host: &str, port: u16) -> Result<SocketAddr, String> {
    let ip: Ipv4Addr = host
        .trim()
        .parse()
        .map_err(|_| "Enter the printer's IP address, like 192.168.1.50.".to_string())?;
    if !(ip.is_private() || ip.is_link_local()) {
        return Err("Only printers on your shop network (192.168.x.x, 10.x.x.x, 172.16–31.x.x) can be used.".into());
    }
    if !RAW_PORTS.contains(&port) {
        return Err("Network printers use port 9100.".into());
    }
    Ok(SocketAddr::new(IpAddr::V4(ip), port))
}

/// COM1…COM255 only (no device paths).
pub fn com_port_name(port: &str) -> Result<String, String> {
    let up = port.trim().trim_end_matches(':').to_ascii_uppercase();
    let ok = up.len() > 3
        && up.len() <= 6
        && up.starts_with("COM")
        && up[3..].chars().all(|c| c.is_ascii_digit())
        && up[3..].parse::<u16>().map_or(false, |n| (1..=255).contains(&n));
    if ok {
        Ok(up)
    } else {
        Err("Choose a COM port such as COM3.".into())
    }
}

fn network_error(addr: &SocketAddr, error: std::io::Error) -> String {
    use std::io::ErrorKind::*;
    match error.kind() {
        TimedOut | WouldBlock => format!("No printer answered at {addr}. Check it is on and connected to the same Wi‑Fi/router."),
        ConnectionRefused => format!("{addr} is reachable but is not accepting print jobs on this port."),
        _ => format!("Could not print to {addr}: {error}"),
    }
}

pub fn send_tcp(addr: SocketAddr, bytes: &[u8]) -> Result<(), String> {
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).map_err(|e| network_error(&addr, e))?;
    stream.set_write_timeout(Some(WRITE_TIMEOUT)).ok();
    stream.set_nodelay(true).ok();
    stream.write_all(bytes).map_err(|e| network_error(&addr, e))?;
    stream.flush().map_err(|e| network_error(&addr, e))?;
    // Let the printer drain its buffer before the socket closes; some cut the job short otherwise.
    stream.shutdown(std::net::Shutdown::Write).ok();
    Ok(())
}

/// What an ESC/POS printer reports about itself (DLE EOT 1, 2 and 4).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterStatus {
    /// False when the printer does not answer status requests (many label printers, some clones).
    pub answered: bool,
    pub offline: bool,
    pub cover_open: bool,
    pub paper_out: bool,
    pub paper_low: bool,
    pub error: bool,
}

/// A real DLE EOT reply has bits 1 and 4 set and bits 0 and 7 clear.
fn status_byte(b: Option<u8>) -> Option<u8> {
    b.filter(|b| b & 0x93 == 0x12)
}

pub fn parse_status(printer: Option<u8>, offline_cause: Option<u8>, paper: Option<u8>) -> PrinterStatus {
    let (p, o, r) = (status_byte(printer), status_byte(offline_cause), status_byte(paper));
    if p.is_none() && o.is_none() && r.is_none() {
        return PrinterStatus::default();
    }
    PrinterStatus {
        answered: true,
        offline: p.map_or(false, |b| b & 0x08 != 0),
        cover_open: o.map_or(false, |b| b & 0x04 != 0),
        paper_out: o.map_or(false, |b| b & 0x20 != 0) || r.map_or(false, |b| b & 0x60 != 0),
        paper_low: r.map_or(false, |b| b & 0x0c != 0),
        error: o.map_or(false, |b| b & 0x40 != 0),
    }
}

/// Asks a network ESC/POS printer for its status. Printers that stay silent report `answered: false`.
pub fn escpos_status(addr: SocketAddr) -> Result<PrinterStatus, String> {
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).map_err(|e| network_error(&addr, e))?;
    stream.set_read_timeout(Some(Duration::from_millis(800))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(2))).ok();
    let mut ask = |n: u8| -> Option<u8> {
        stream.write_all(&[0x10, 0x04, n]).ok()?;
        let mut byte = [0u8; 1];
        match stream.read(&mut byte) {
            Ok(1) => Some(byte[0]),
            _ => None,
        }
    };
    let printer = ask(1);
    // A printer that ignores the first request will ignore the rest; don't wait for them.
    if printer.is_none() {
        return Ok(PrinterStatus::default());
    }
    let offline_cause = ask(2);
    let paper = ask(4);
    Ok(parse_status(printer, offline_cause, paper))
}

pub fn probe_tcp(addr: SocketAddr, timeout: Duration) -> bool {
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

/// This PC's LAN address (no packet is sent: connecting a UDP socket only picks the route).
fn local_lan_ip() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.168.0.1:9").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if ip.is_private() => Some(ip),
        _ => None,
    }
}

/// Every address on this PC's /24 that accepts a connection on `port`.
pub fn scan_lan(port: u16) -> Result<Vec<String>, String> {
    if !RAW_PORTS.contains(&port) {
        return Err("Network printers use port 9100.".into());
    }
    let me = local_lan_ip().ok_or("This computer is not on a shop network (Wi‑Fi or LAN).")?;
    let [a, b, c, own] = me.octets();
    let candidates: Vec<Ipv4Addr> = (1..=254u8).filter(|d| *d != own).map(|d| Ipv4Addr::new(a, b, c, d)).collect();
    let mut found = Vec::new();
    for batch in candidates.chunks(64) {
        let handles: Vec<_> = batch
            .iter()
            .map(|ip| {
                let addr = SocketAddr::new(IpAddr::V4(*ip), port);
                std::thread::spawn(move || probe_tcp(addr, SCAN_TIMEOUT).then_some(addr.ip().to_string()))
            })
            .collect();
        found.extend(handles.into_iter().filter_map(|h| h.join().ok().flatten()));
    }
    Ok(found)
}

pub fn send_serial(port: &str, bytes: &[u8]) -> Result<(), String> {
    let name = com_port_name(port)?;
    let path = format!(r"\\.\{name}");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .map_err(|e| match e.raw_os_error() {
            Some(2) => format!("{name} is not available. Turn the printer on, or pair it again in Windows Bluetooth settings."),
            Some(5) => format!("{name} is in use by another program."),
            Some(121) => format!("{name} is not answering. Turn the printer on and try again."),
            _ => format!("Could not open {name}: {e}"),
        })?;
    // Write in small pieces: Bluetooth serial links and cheap USB-serial chips have small buffers.
    for chunk in bytes.chunks(512) {
        file.write_all(chunk).map_err(|e| format!("Printing on {name} stopped: {e}"))?;
    }
    file.flush().map_err(|e| format!("Printing on {name} stopped: {e}"))
}

#[cfg(windows)]
mod win {
    use super::{attachment_for, WindowsPrinter};
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW, OpenPrinterW, StartDocPrinterW,
        StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ATTRIBUTE_WORK_OFFLINE, PRINTER_ENUM_CONNECTIONS,
        PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_2W,
    };

    const PRINTER_STATUS_PAUSED: u32 = 0x1;
    const PRINTER_STATUS_ERROR: u32 = 0x2;
    const PRINTER_STATUS_PAPER_JAM: u32 = 0x8;
    const PRINTER_STATUS_PAPER_OUT: u32 = 0x10;
    const PRINTER_STATUS_OFFLINE: u32 = 0x80;
    const PRINTER_STATUS_NOT_AVAILABLE: u32 = 0x1000;
    const PRINTER_STATUS_DOOR_OPEN: u32 = 0x400000;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn read(p: PWSTR) -> String {
        if p.is_null() {
            String::new()
        } else {
            p.to_string().unwrap_or_default()
        }
    }

    fn default_printer() -> String {
        let mut len = 0u32;
        unsafe {
            let _ = GetDefaultPrinterW(None, &mut len);
            if len == 0 {
                return String::new();
            }
            let mut buf = vec![0u16; len as usize];
            if GetDefaultPrinterW(Some(PWSTR(buf.as_mut_ptr())), &mut len).as_bool() {
                return String::from_utf16_lossy(&buf[..len.saturating_sub(1) as usize]);
            }
        }
        String::new()
    }

    pub fn list_printers() -> Result<Vec<WindowsPrinter>, String> {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let (mut needed, mut count) = (0u32, 0u32);
        unsafe {
            let _ = EnumPrintersW(flags, PCWSTR::null(), 2, None, &mut needed, &mut count);
        }
        if needed == 0 {
            return Ok(Vec::new());
        }
        // u64 backing keeps the PRINTER_INFO_2W array aligned.
        let mut buf = vec![0u64; (needed as usize).div_ceil(8)];
        let bytes = unsafe { std::slice::from_raw_parts_mut(buf.as_mut_ptr() as *mut u8, buf.len() * 8) };
        unsafe { EnumPrintersW(flags, PCWSTR::null(), 2, Some(bytes), &mut needed, &mut count) }
            .map_err(|e| format!("Could not read the Windows printer list: {e}"))?;

        let default_name = default_printer();
        let infos = unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const PRINTER_INFO_2W, count as usize) };
        Ok(infos
            .iter()
            .map(|info| unsafe {
                let name = read(info.pPrinterName);
                let port = read(info.pPortName);
                let driver = read(info.pDriverName);
                let status = info.Status;
                WindowsPrinter {
                    attachment: attachment_for(&name, &port, &driver),
                    is_default: name == default_name,
                    offline: info.Attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE != 0
                        || status & (PRINTER_STATUS_OFFLINE | PRINTER_STATUS_NOT_AVAILABLE) != 0,
                    paused: status & PRINTER_STATUS_PAUSED != 0,
                    error: status
                        & (PRINTER_STATUS_ERROR | PRINTER_STATUS_PAPER_JAM | PRINTER_STATUS_PAPER_OUT | PRINTER_STATUS_DOOR_OPEN)
                        != 0,
                    name,
                    port,
                    driver,
                }
            })
            .collect())
    }

    struct Handle(PRINTER_HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                let _ = ClosePrinter(self.0);
            }
        }
    }

    /// One RAW spooler job: the bytes reach the printer exactly as built (no driver rendering).
    pub fn print_raw(printer: &str, title: &str, bytes: &[u8]) -> Result<(), String> {
        let name = wide(printer);
        let mut handle = PRINTER_HANDLE::default();
        unsafe { OpenPrinterW(PCWSTR(name.as_ptr()), &mut handle, None) }
            .map_err(|_| format!("Windows could not open \"{printer}\". Check it is installed and turned on."))?;
        let handle = Handle(handle);

        let mut doc_name = wide(title);
        let mut datatype = wide("RAW");
        let doc = DOC_INFO_1W {
            pDocName: PWSTR(doc_name.as_mut_ptr()),
            pOutputFile: PWSTR::null(),
            pDatatype: PWSTR(datatype.as_mut_ptr()),
        };
        unsafe {
            if StartDocPrinterW(handle.0, 1, &doc) == 0 {
                return Err(format!(
                    "\"{printer}\" does not accept direct printing. Install the maker's Windows driver (or \"Generic / Text Only\") for it."
                ));
            }
            let result = (|| {
                if !StartPagePrinter(handle.0).as_bool() {
                    return Err(format!("Windows could not start the print on \"{printer}\"."));
                }
                let mut written = 0u32;
                let ok = WritePrinter(handle.0, bytes.as_ptr().cast(), bytes.len() as u32, &mut written).as_bool();
                let _ = EndPagePrinter(handle.0);
                if !ok || written as usize != bytes.len() {
                    return Err(format!("Printing on \"{printer}\" stopped part-way. Check paper and cable."));
                }
                Ok(())
            })();
            let _ = EndDocPrinter(handle.0);
            result
        }
    }

    /// COM ports Windows knows about right now (USB-serial adapters, Bluetooth serial links).
    pub fn serial_ports() -> Vec<String> {
        let Ok(key) = windows_registry::LOCAL_MACHINE.open(r"HARDWARE\DEVICEMAP\SERIALCOMM") else {
            return Vec::new();
        };
        let Ok(values) = key.values() else {
            return Vec::new();
        };
        let mut ports: Vec<String> = values.filter_map(|(_, v)| String::try_from(v).ok()).collect();
        ports.sort_by_key(|p| p.trim_start_matches("COM").parse::<u16>().unwrap_or(u16::MAX));
        ports.dedup();
        ports
    }
}

#[cfg(not(windows))]
mod win {
    use super::WindowsPrinter;
    pub fn list_printers() -> Result<Vec<WindowsPrinter>, String> {
        Ok(Vec::new())
    }
    pub fn print_raw(_printer: &str, _title: &str, _bytes: &[u8]) -> Result<(), String> {
        Err("Windows printers are only available on Windows.".into())
    }
    pub fn serial_ports() -> Vec<String> {
        Vec::new()
    }
}

/// Names of the printers installed on this PC (used to refuse anything else).
pub fn installed_printer_names() -> Result<Vec<String>, String> {
    Ok(win::list_printers()?.into_iter().map(|p| p.name).collect())
}

/// Runs blocking printer I/O off the UI thread.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "Printing was interrupted.".to_string())?
}

#[tauri::command]
pub async fn desktop_list_printers() -> Result<Vec<WindowsPrinter>, String> {
    blocking(win::list_printers).await
}

#[tauri::command]
pub async fn desktop_print_windows(printer: String, data: String, title: Option<String>) -> Result<(), String> {
    let bytes = decode_job(&data)?;
    blocking(move || {
        // Only printers installed on this PC (no arbitrary \\server\share names from the page).
        if !win::list_printers()?.iter().any(|p| p.name == printer) {
            return Err(format!("\"{printer}\" is no longer installed on this computer."));
        }
        let title = title.unwrap_or_else(|| "Khatario".into());
        win::print_raw(&printer, &title.chars().take(60).collect::<String>(), &bytes)
    })
    .await
}

#[tauri::command]
pub async fn desktop_print_network(host: String, port: Option<u16>, data: String) -> Result<(), String> {
    let addr = lan_address(&host, port.unwrap_or(9100))?;
    let bytes = decode_job(&data)?;
    blocking(move || send_tcp(addr, &bytes)).await
}

#[tauri::command]
pub async fn desktop_probe_network(host: String, port: Option<u16>) -> Result<bool, String> {
    let addr = lan_address(&host, port.unwrap_or(9100))?;
    blocking(move || Ok(probe_tcp(addr, CONNECT_TIMEOUT))).await
}

#[tauri::command]
pub async fn desktop_network_printer_status(host: String, port: Option<u16>) -> Result<PrinterStatus, String> {
    let addr = lan_address(&host, port.unwrap_or(9100))?;
    blocking(move || escpos_status(addr)).await
}

#[tauri::command]
pub async fn desktop_scan_network(port: Option<u16>) -> Result<Vec<String>, String> {
    let port = port.unwrap_or(9100);
    blocking(move || scan_lan(port)).await
}

#[tauri::command]
pub async fn desktop_list_serial_ports() -> Result<Vec<String>, String> {
    blocking(|| Ok(win::serial_ports())).await
}

#[tauri::command]
pub async fn desktop_print_serial(port: String, data: String) -> Result<(), String> {
    let bytes = decode_job(&data)?;
    blocking(move || send_serial(&port, &bytes)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;

    #[test]
    fn guesses_how_printers_are_attached() {
        assert_eq!(attachment_for("TVS RP 3160 GOLD", "USB001", "TVS RP3160"), Attachment::Usb);
        assert_eq!(attachment_for("Epson TM-T82X", "IP_192.168.1.50", "EPSON TM-T82X"), Attachment::Network);
        assert_eq!(attachment_for("Thermal", "COM5:", "Generic / Text Only"), Attachment::Serial);
        assert_eq!(attachment_for("Microsoft Print to PDF", "PORTPROMPT:", "Microsoft Print To PDF"), Attachment::Virtual);
        assert_eq!(attachment_for("OneNote (Desktop)", "nul:", "Send to Microsoft OneNote 16 Driver"), Attachment::Virtual);
    }

    #[test]
    fn accepts_only_shop_network_addresses() {
        assert!(lan_address("192.168.1.50", 9100).is_ok());
        assert!(lan_address("10.0.0.7", 9101).is_ok());
        assert!(lan_address("172.20.1.2", 9100).is_ok());
        assert!(lan_address("8.8.8.8", 9100).is_err());
        assert!(lan_address("127.0.0.1", 9100).is_err());
        assert!(lan_address("192.168.1.50", 22).is_err());
        assert!(lan_address("printer.local", 9100).is_err());
    }

    #[test]
    fn accepts_only_com_port_names() {
        assert_eq!(com_port_name("com3").unwrap(), "COM3");
        assert_eq!(com_port_name("COM12:").unwrap(), "COM12");
        assert!(com_port_name(r"\\.\PhysicalDrive0").is_err());
        assert!(com_port_name("COM0").is_err());
        assert!(com_port_name("LPT1").is_err());
    }

    #[test]
    fn decodes_and_limits_jobs() {
        assert_eq!(decode_job("G0A=").unwrap(), vec![0x1b, 0x40]);
        assert!(decode_job("").is_err());
        assert!(decode_job("not base64!").is_err());
    }

    #[test]
    fn reads_escpos_status_bytes() {
        // Online, cover closed, paper fine.
        assert_eq!(
            parse_status(Some(0x12), Some(0x12), Some(0x12)),
            PrinterStatus { answered: true, ..Default::default() }
        );
        // Cover open + paper end.
        let s = parse_status(Some(0x1a), Some(0x16), Some(0x72));
        assert!(s.answered && s.offline && s.cover_open && s.paper_out);
        // Paper near end only.
        let s = parse_status(Some(0x12), Some(0x12), Some(0x1e));
        assert!(s.paper_low && !s.paper_out);
        // Garbage or silence is "did not answer", not "fine".
        assert!(!parse_status(None, None, None).answered);
        assert!(!parse_status(Some(0xff), None, None).answered);
    }

    #[test]
    fn sends_bytes_over_tcp() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let reader = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut got = Vec::new();
            s.read_to_end(&mut got).unwrap();
            got
        });
        send_tcp(addr, b"\x1b@Hello\n").unwrap();
        assert_eq!(reader.join().unwrap(), b"\x1b@Hello\n");
    }
}
