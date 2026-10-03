/** Seeded once for a business that has no categories yet: [name, ledger code, s.17(5) blocked]. */
export const DEFAULT_EXPENSE_CATEGORIES: ReadonlyArray<readonly [string, string, boolean]> = [
  ['Rent', '5213', false],
  ['Electricity', '5201', false],
  ['Salaries & Wages', '5212', false],
  ['Transport & Freight', '5202', false],
  ['Office Supplies', '5201', false],
  ['Telephone & Internet', '5201', false],
  ['Repairs & Maintenance', '5201', false],
  ['Professional Fees', '5216', false],
  ['Bank Charges', '5217', false],
  ['Food & Refreshments', '5214', true],
  ['Staff Welfare', '5214', false],
  ['Travelling & Conveyance', '5215', false],
  ['Miscellaneous', '5201', false],
];
