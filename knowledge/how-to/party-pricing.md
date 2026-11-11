---
title: How to set customer-wise prices, price levels and schemes
audience: [tenant_user]
locale: en
tags: [party pricing, customer price, customer wise rate, price level, wholesale rate, dealer rate, quantity slab, discount, category discount, scheme, buy 10 get 1 free, free goods, mrp, price list, last rate, how to]
url: /pricing/party-item
required_feature: party_pricing
---

# Customer-wise prices, price levels and schemes: how-to

## How do I give a customer their own price for an item?

Go to Inventory > **Party Pricing**, choose the customer and type their price (or a discount %) against each item, with optional start and end dates. Items with sizes or colours can have a price for one variant; a variant without its own price uses the customer's price for the whole item. The page also has **Category discounts** (for example 5% off everything in Biscuits for this customer) and a History of every rate change. Prices can be imported and exported as CSV. Party pricing is included from the Starter plan upwards (see the plans document).

Customer ke hisaab se alag rate kaise lagaye? Inventory > Party Pricing mein customer chuno aur har item ka uska rate ya discount daalo. Bill banate hi wahi rate lagta hai.

## What are price levels (wholesale, dealer rates)?

A price level is a named rate list, such as Wholesale or Dealer, that you put many customers on. Create it in Inventory > **Price Levels**: add a rate or discount % per item, with quantity slabs (a lower rate from a minimum quantity) and dates if needed. Fill a level from the item prices ±% in one go, raise or lower every rate by a %, and import or export rates as CSV. Put a customer on a level from Party Pricing (Price level).

## Which price does a bill use?

On invoices, sales orders, delivery challans and the phone bill form, Khatario picks, in order: the customer's own price, then their price level, then the item's normal price, and then applies any customer, category or level discount. No picked price goes above the item's MRP. A price you type by hand, a price loaded from a saved document, or one agreed on a Supplier Hub order is kept. Each line shows the last rate you charged that customer and warns when the price is below your purchase price. Purchases show the last rate you paid the supplier.

## How do I set up a scheme like "buy 10, get 1 free"?

Go to Inventory > **Schemes** > New scheme. Choose the item (or one variant), how many must be bought and how many are free, who gets it (every customer or one customer) and the dates. When a bill meets the quantity, the free units are added as their own line at no charge, so stock goes down for them too.

## How do I print a price list for a customer?

Inventory > **Price List**. Choose the customer (or Everyone for item prices) and the date; it shows the rate, discount and net rate they pay for each item. Print it or download it.
