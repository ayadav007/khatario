/**
 * Converts a number to words in Indian format
 * Pure function - no side effects
 * Example: 1234.56 -> "One Thousand Two Hundred Thirty Four Rupees and Fifty Six Paise Only"
 */
export function numberToWords(num: number): string {
  if (isNaN(num)) return '';
  
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b = ['','', 'Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  
  const toWords = (n: number): string => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n/10)] + (n%10 ? ' ' + a[n%10] : '');
    if (n < 1000) return a[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + toWords(n%100) : '');
    if (n < 100000) return toWords(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' ' + toWords(n%1000) : '');
    if (n < 10000000) return toWords(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' ' + toWords(n%100000) : '');
    return toWords(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' ' + toWords(n%10000000) : '');
  };
  
  const whole = Math.floor(num);
  const decimal = Math.round((num - whole) * 100);
  const wholeWords = whole === 0 ? 'Zero' : toWords(whole);
  const decWords = decimal > 0 ? ` and ${toWords(decimal)} Paise` : '';
  return `${wholeWords} Rupees${decWords} Only`;
}

