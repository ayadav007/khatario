export function canBookShipment(paymentStatus: string): boolean {
  return paymentStatus === 'paid' || paymentStatus === 'cod';
}

export function shouldDecrementStockOnPlace(paymentMethod: 'cod' | 'razorpay'): boolean {
  return paymentMethod === 'cod';
}
