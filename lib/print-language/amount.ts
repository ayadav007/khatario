import type { DocumentLanguage } from './codes';

type AmountWords = {
  zero: string;
  ones: string[];
  tens: string[];
  hundred: string;
  thousand: string;
  lakh: string;
  crore: string;
  rupees: string;
  paise: string;
  only: string;
  and: string;
  minus: string;
  /** When set, index is the number 0–99 and composition is skipped. */
  below100?: string[];
};

const HI_BELOW_100 = [
  'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ',
  'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस',
  'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चौवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास',
  'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर',
  'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उन्यासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सतासी', 'अट्ठासी', 'नवासी',
  'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पचानवे', 'छियानवे', 'सतानवे', 'अट्ठानवे', 'निन्यानवे',
];

function words(partial: Omit<AmountWords, 'ones' | 'tens'> & { ones: string[]; tens: string[] }): AmountWords {
  return partial;
}

const TABLES: Record<Exclude<DocumentLanguage, 'en'>, AmountWords> = {
  hi: words({
    zero: 'शून्य', ones: HI_BELOW_100.slice(0, 20), tens: [], hundred: 'सौ', thousand: 'हज़ार',
    lakh: 'लाख', crore: 'करोड़', rupees: 'रुपये', paise: 'पैसे', only: 'मात्र', and: 'और', minus: 'ऋण',
    below100: HI_BELOW_100,
  }),
  hinglish: words({
    zero: 'Zero', ones: ['', 'Ek', 'Do', 'Teen', 'Char', 'Paanch', 'Chheh', 'Saat', 'Aath', 'Nau', 'Dus', 'Gyarah', 'Barah', 'Terah', 'Chaudah', 'Pandrah', 'Solah', 'Satrah', 'Atharah', 'Unnees'],
    tens: ['', '', 'Bees', 'Tees', 'Chalees', 'Pachaas', 'Saath', 'Sattar', 'Assi', 'Nabbe'],
    hundred: 'Sau', thousand: 'Hazaar', lakh: 'Lakh', crore: 'Crore', rupees: 'Rupaye', paise: 'Paise', only: 'Matra', and: 'aur', minus: 'Minus',
  }),
  mr: words({
    zero: 'शून्य', ones: ['', 'एक', 'दोन', 'तीन', 'चार', 'पाच', 'सहा', 'सात', 'आठ', 'नऊ', 'दहा', 'अकरा', 'बारा', 'तेरा', 'चौदा', 'पंधरा', 'सोळा', 'सतरा', 'अठरा', 'एकोणीस'],
    tens: ['', '', 'वीस', 'तीस', 'चाळीस', 'पन्नास', 'साठ', 'सत्तर', 'ऐंशी', 'नव्वद'],
    hundred: 'शे', thousand: 'हजार', lakh: 'लाख', crore: 'कोटी', rupees: 'रुपये', paise: 'पैसे', only: 'फक्त', and: 'आणि', minus: 'उणे',
  }),
  gu: words({
    zero: 'શૂન્ય', ones: ['', 'એક', 'બે', 'ત્રણ', 'ચાર', 'પાંચ', 'છ', 'સાત', 'આઠ', 'નવ', 'દસ', 'અગિયાર', 'બાર', 'તેર', 'ચૌદ', 'પંદર', 'સોળ', 'સત્તર', 'અઢાર', 'ઓગણીસ'],
    tens: ['', '', 'વીસ', 'ત્રીસ', 'ચાળીસ', 'પચાસ', 'સાઠ', 'સિત્તેર', 'એંસી', 'નેવું'],
    hundred: 'સો', thousand: 'હજાર', lakh: 'લાખ', crore: 'કરોડ', rupees: 'રૂપિયા', paise: 'પૈસા', only: 'માત્ર', and: 'અને', minus: 'ઋણ',
  }),
  ta: words({
    zero: 'பூஜ்யம்', ones: ['', 'ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது', 'பத்து', 'பதினொன்று', 'பன்னிரண்டு', 'பதிமூன்று', 'பதினான்கு', 'பதினைந்து', 'பதினாறு', 'பதினேழு', 'பதினெட்டு', 'பத்தொன்பது'],
    tens: ['', '', 'இருபது', 'முப்பது', 'நாற்பது', 'ஐம்பது', 'அறுபது', 'எழுபது', 'எண்பது', 'தொண்ணூறு'],
    hundred: 'நூறு', thousand: 'ஆயிரம்', lakh: 'இலட்சம்', crore: 'கோடி', rupees: 'ரூபாய்', paise: 'பைசா', only: 'மட்டும்', and: 'மற்றும்', minus: 'கழித்தல்',
  }),
  te: words({
    zero: 'సున్న', ones: ['', 'ఒకటి', 'రెండు', 'మూడు', 'నాలుగు', 'ఐదు', 'ఆరు', 'ఏడు', 'ఎనిమిది', 'తొమ్మిది', 'పది', 'పదకొండు', 'పన్నెండు', 'పదమూడు', 'పద్నాలుగు', 'పదిహేను', 'పదహారు', 'పదిహేడు', 'పద్దెనిమిది', 'పంతొమ్మిది'],
    tens: ['', '', 'ఇరవై', 'ముప్పై', 'నలభై', 'యాభై', 'అరవై', 'డెబ్బై', 'ఎనభై', 'తొంభై'],
    hundred: 'వంద', thousand: 'వేలు', lakh: 'లక్ష', crore: 'కోటి', rupees: 'రూపాయలు', paise: 'పైసలు', only: 'మాత్రమే', and: 'మరియు', minus: 'మైనస్',
  }),
  kn: words({
    zero: 'ಸೊನ್ನೆ', ones: ['', 'ಒಂದು', 'ಎರಡು', 'ಮೂರು', 'ನಾಲ್ಕು', 'ಐದು', 'ಆರು', 'ಏಳು', 'ಎಂಟು', 'ಒಂಬತ್ತು', 'ಹತ್ತು', 'ಹನ್ನೊಂದು', 'ಹನ್ನೆರಡು', 'ಹದಿಮೂರು', 'ಹದಿನಾಲ್ಕು', 'ಹದಿನೈದು', 'ಹದಿನಾರು', 'ಹದಿನೇಳು', 'ಹದಿನೆಂಟು', 'ಹತ್ತೊಂಬತ್ತು'],
    tens: ['', '', 'ಇಪ್ಪತ್ತು', 'ಮೂವತ್ತು', 'ನಲವತ್ತು', 'ಐವತ್ತು', 'ಅರವತ್ತು', 'ಎಪ್ಪತ್ತು', 'ಎಂಬತ್ತು', 'ತೊಂಬತ್ತು'],
    hundred: 'ನೂರು', thousand: 'ಸಾವಿರ', lakh: 'ಲಕ್ಷ', crore: 'ಕೋಟಿ', rupees: 'ರೂಪಾಯಿ', paise: 'ಪೈಸೆ', only: 'ಮಾತ್ರ', and: 'ಮತ್ತು', minus: 'ಋಣ',
  }),
  ml: words({
    zero: 'പൂജ്യം', ones: ['', 'ഒന്ന്', 'രണ്ട്', 'മൂന്ന്', 'നാല്', 'അഞ്ച്', 'ആറ്', 'ഏഴ്', 'എട്ട്', 'ഒമ്പത്', 'പത്ത്', 'പതിനൊന്ന്', 'പന്ത്രണ്ട്', 'പതിമൂന്ന്', 'പതിനാല്', 'പതിനഞ്ച്', 'പതിനാറ്', 'പതിനേഴ്', 'പതിനെട്ട്', 'പത്തൊമ്പത്'],
    tens: ['', '', 'ഇരുപത്', 'മുപ്പത്', 'നാൽപ്പത്', 'അമ്പത്', 'അറുപത്', 'എഴുപത്', 'എൺപത്', 'തൊണ്ണൂറ്'],
    hundred: 'നൂറ്', thousand: 'ആയിരം', lakh: 'ലക്ഷം', crore: 'കോടി', rupees: 'രൂപ', paise: 'പൈസ', only: 'മാത്രം', and: 'ഒപ്പം', minus: 'മൈനസ്',
  }),
  bn: words({
    zero: 'শূন্য', ones: ['', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়', 'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ'],
    tens: ['', '', 'বিশ', 'ত্রিশ', 'চল্লিশ', 'পঞ্চাশ', 'ষাট', 'সত্তর', 'আশি', 'নব্বই'],
    hundred: 'শত', thousand: 'হাজার', lakh: 'লাখ', crore: 'কোটি', rupees: 'টাকা', paise: 'পয়সা', only: 'মাত্র', and: 'এবং', minus: 'বিয়োগ',
  }),
  pa: words({
    zero: 'ਸਿਫ਼ਰ', ones: ['', 'ਇੱਕ', 'ਦੋ', 'ਤਿੰਨ', 'ਚਾਰ', 'ਪੰਜ', 'ਛੇ', 'ਸੱਤ', 'ਅੱਠ', 'ਨੌਂ', 'ਦਸ', 'ਗਿਆਰਾਂ', 'ਬਾਰਾਂ', 'ਤੇਰਾਂ', 'ਚੌਦਾਂ', 'ਪੰਦਰਾਂ', 'ਸੋਲਾਂ', 'ਸਤਾਰਾਂ', 'ਅਠਾਰਾਂ', 'ਉੱਨੀ'],
    tens: ['', '', 'ਵੀਹ', 'ਤੀਹ', 'ਚਾਲੀ', 'ਪੰਜਾਹ', 'ਸੱਠ', 'ਸੱਤਰ', 'ਅੱਸੀ', 'ਨੱਬੇ'],
    hundred: 'ਸੌ', thousand: 'ਹਜ਼ਾਰ', lakh: 'ਲੱਖ', crore: 'ਕਰੋੜ', rupees: 'ਰੁਪਏ', paise: 'ਪੈਸੇ', only: 'ਮਾਤਰ', and: 'ਅਤੇ', minus: 'ਘਟਾਓ',
  }),
  or: words({
    zero: 'ଶୂନ', ones: ['', 'ଏକ', 'ଦୁଇ', 'ତିନି', 'ଚାରି', 'ପାଞ୍ଚ', 'ଛଅ', 'ସାତ', 'ଆଠ', 'ନଅ', 'ଦଶ', 'ଏଗାର', 'ବାର', 'ତେର', 'ଚଉଦ', 'ପନ୍ଦର', 'ଷୋହଳ', 'ସତର', 'ଅଠର', 'ଊନବିଂଶ'],
    tens: ['', '', 'କୋଡ଼ିଏ', 'ତିରିଶ', 'ଚାଳିଶ', 'ପଚାଶ', 'ଷାଠିଏ', 'ସତୁରି', 'ଅଶୀ', 'ନବେ'],
    hundred: 'ଶହ', thousand: 'ହଜାର', lakh: 'ଲକ୍ଷ', crore: 'କୋଟି', rupees: 'ଟଙ୍କା', paise: 'ପଇସା', only: 'ମାତ୍ର', and: 'ଏବଂ', minus: 'ବିୟୋଗ',
  }),
  ur: words({
    zero: 'صفر', ones: ['', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو', 'دس', 'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس'],
    tens: ['', '', 'بیس', 'تیس', 'چالیس', 'پچاس', 'ساٹھ', 'ستر', 'اسی', 'نوے'],
    hundred: 'سو', thousand: 'ہزار', lakh: 'لاکھ', crore: 'کروڑ', rupees: 'روپے', paise: 'پیسے', only: 'صرف', and: 'اور', minus: 'منفی',
  }),
};

function belowHundred(n: number, table: AmountWords): string {
  if (table.below100) return table.below100[n] || table.zero;
  if (n < 20) return table.ones[n] || table.zero;
  const ten = table.tens[Math.floor(n / 10)] || '';
  const one = n % 10 ? table.ones[n % 10] : '';
  return [ten, one].filter(Boolean).join(' ');
}

function toWords(n: number, table: AmountWords): string {
  if (n === 0) return table.zero;
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (crore) parts.push(`${toWords(crore, table)} ${table.crore}`);
  if (lakh) parts.push(`${belowHundred(lakh, table)} ${table.lakh}`);
  if (thousand) parts.push(`${belowHundred(thousand, table)} ${table.thousand}`);
  if (hundred) parts.push(`${table.ones[hundred] || belowHundred(hundred, table)} ${table.hundred}`);
  if (rest) parts.push(belowHundred(rest, table));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function englishAmountInWords(num: number): string {
  if (Number.isNaN(num) || num === 0) return 'Zero Rupees Only';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const toEnglish = (n: number): string => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + toEnglish(n % 100) : '');
    if (n < 100000) return toEnglish(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + toEnglish(n % 1000) : '');
    if (n < 10000000) return toEnglish(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + toEnglish(n % 100000) : '');
    return toEnglish(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + toEnglish(n % 10000000) : '');
  };
  const whole = Math.floor(Math.abs(num));
  const decimal = Math.round((Math.abs(num) - whole) * 100);
  const wholeWords = whole === 0 ? 'Zero' : toEnglish(whole);
  const decWords = decimal > 0 ? ` and ${toEnglish(decimal)} Paise` : '';
  return `${num < 0 ? 'Minus ' : ''}${wholeWords} Rupees${decWords} Only`;
}

export function amountInWords(value: number, language: DocumentLanguage): string {
  const num = Number(value);
  if (language === 'en') return englishAmountInWords(num);
  if (Number.isNaN(num) || num === 0) {
    const table = TABLES[language];
    return `${table.zero} ${table.rupees} ${table.only}`;
  }
  const table = TABLES[language];
  const whole = Math.floor(Math.abs(num));
  const decimal = Math.round((Math.abs(num) - whole) * 100);
  const wholeWords = whole === 0 ? table.zero : toWords(whole, table);
  const decWords = decimal > 0 ? ` ${table.and} ${toWords(decimal, table)} ${table.paise}` : '';
  const sign = num < 0 ? `${table.minus} ` : '';
  return `${sign}${wholeWords} ${table.rupees}${decWords} ${table.only}`.replace(/\s+/g, ' ').trim();
}
