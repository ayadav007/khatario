/**
 * Build goods GST rate entries from Notification 9/2025-Central Tax (Rate).
 * The rate on each schedule is CGST. The stored rate is the combined GST
 * (CGST + SGST, equal to IGST).
 *
 * Source: https://taxinformation.cbic.gov.in/view-pdf/1010436/ENG/Notifications
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { PDFParse } = require('pdf-parse');

// English text of Notification 9/2025-Central Tax (Rate). The CBIC viewer page is not a direct PDF.
const SOURCE_URL = 'https://cggst.com/uploads/document/1758177743-092025-central-tax-rate.pdf';
const OUT_PATH = path.join(__dirname, '..', 'data', 'gst-rate-schedule.json');

const SCHEDULES = [
  { name: 'I', gstRate: 5, pattern: /Schedule I\s*[–—-]\s*2\.5\s*%/i },
  { name: 'II', gstRate: 18, pattern: /Schedule II\s*[–—-]\s*9\s*%/i },
  { name: 'III', gstRate: 40, pattern: /Schedule III\s*[–—-]\s*20\s*%/i },
  { name: 'IV', gstRate: 3, pattern: /Schedule IV\s*[–—-]\s*1\.5\s*%/i },
  { name: 'V', gstRate: 0.25, pattern: /Schedule V\s*[–—-]\s*0\.125\s*%/i },
  { name: 'VI', gstRate: 1.5, pattern: /Schedule VI\s*[–—-]\s*0\.75\s*%/i },
  { name: 'VII', gstRate: 28, pattern: /Schedule VII\s*[–—-]\s*14\s*%/i },
];

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        download(response.headers.location).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: ${response.statusCode}`));
        response.resume();
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function splitCodes(text) {
  return String(text)
    .split(/,|\bor\b/i)
    .map((part) => part.replace(/\s+/g, ''))
    .filter((part) => /^\d{1,8}$/.test(part))
    .map((part) => (part.length === 1 ? `0${part}` : part));
}

function parseCodeCell(cell) {
  if (/any\s+chapter/i.test(cell)) return null;
  const except = [];
  const main = cell.replace(/[\[(]\s*except\s+([^)\]]+)[\])]/gi, (_, list) => {
    except.push(...splitCodes(list));
    return ' ';
  });
  const codes = splitCodes(main);
  if (codes.length === 0) return null;
  return { codes, except };
}

function isCodeContinuation(line) {
  return /^[\d,\s]+$/.test(line);
}

function parseScheduleSlice(slice, schedule) {
  const entries = [];
  let current = null;

  function flush() {
    if (!current) return;
    const parsed = parseCodeCell(current.code);
    const description = current.description.replace(/\s+/g, ' ').trim();
    if (parsed && !/^\[?\s*omitted\s*\]?$/i.test(description)) {
      entries.push({
        schedule: schedule.name,
        gst_rate: schedule.gstRate,
        codes: parsed.codes,
        except: parsed.except,
        description: description.slice(0, 240),
      });
    }
    current = null;
  }

  for (const raw of slice.split(/\n/)) {
    const line = raw.trim();
    if (!line || /^-- \d+ of \d+ --$/.test(line)) continue;
    if (/^(S\. No\.|Chapter\/|heading\/|Description of goods|\([123]\))/.test(line)) continue;

    const start = line.match(/^(\d+[A-Z]?)\.\s+(.+)$/);
    if (start) {
      flush();
      const parts = start[2].split(/\t+/);
      current = {
        code: parts[0].trim(),
        description: parts.slice(1).join(' ').trim(),
      };
      continue;
    }

    if (!current) continue;
    if (isCodeContinuation(line)) current.code += ` ${line}`;
    else current.description += ` ${line}`;
  }

  flush();
  return entries;
}

function parseEntries(text) {
  const end = text.search(/Explanation\.\s*[—–-]\s*For the purposes of this notification/i);
  const body = end > 0 ? text.slice(0, end) : text;
  const marks = SCHEDULES.map((schedule) => {
    const match = schedule.pattern.exec(body);
    return match ? { ...schedule, index: match.index } : null;
  }).filter(Boolean).sort((a, b) => a.index - b.index);

  if (marks.length !== SCHEDULES.length) {
    throw new Error(`Found ${marks.length} schedules, expected ${SCHEDULES.length}`);
  }

  return marks.flatMap((schedule, index) => {
    const slice = body.slice(schedule.index, marks[index + 1] ? marks[index + 1].index : body.length);
    return parseScheduleSlice(slice, schedule);
  });
}

async function main() {
  const localPdf = process.argv[2];
  const pdf = localPdf
    ? fs.readFileSync(localPdf)
    : await download(SOURCE_URL);
  console.log(localPdf ? `Reading ${localPdf}` : 'Downloading Notification 9/2025-Central Tax (Rate)...');
  const parser = new PDFParse({ data: pdf });
  const parsed = await parser.getText();
  const text = typeof parsed === 'string' ? parsed : parsed.text;
  if (!text || !text.includes('9/2025')) {
    throw new Error('Downloaded file is not Notification 9/2025');
  }

  const entries = parseEntries(text);
  const payload = {
    source: 'Notification 9/2025-Central Tax (Rate)',
    effective_from: '2025-09-22',
    note: 'gst_rate is the combined rate (CGST + SGST, or IGST). A code can match more than one entry.',
    entries,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload));
  console.log(`Wrote ${entries.length} entries to ${OUT_PATH}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { parseEntries, parseCodeCell };
