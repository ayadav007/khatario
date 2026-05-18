# 🤖 WhatsApp Bot Rules - Complete Guide & Examples

This guide explains how to use the advanced WhatsApp Bot Automation system to create professional-grade conversational flows, similar to WATI, Interakt, Zoko, and other enterprise bot platforms.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Trigger Types Explained](#trigger-types-explained)
4. [Response Types Explained](#response-types-explained)
5. [Real-World Examples](#real-world-examples)
6. [Message Chaining & Flows](#message-chaining--flows)
7. [Advanced Features](#advanced-features)
8. [Best Practices](#best-practices)

---

## 🎯 Overview

The Bot Rules system allows you to:
- **Automatically respond** to incoming WhatsApp messages
- **Create multi-step conversation flows** (like lead qualification, order placement)
- **Filter messages** based on conditions (labels, sender type, inactivity)
- **Perform automatic actions** (add labels, create leads, send follow-ups)
- **Chain rules together** to build complex workflows
- **Extract and use context variables** (customer name, phone, etc.)

---

## 🚀 Getting Started

### Step 1: Access Bot Rules

1. Go to **Settings** → **WhatsApp** → **Bot Rules** tab
2. Click **"Create Rule"** to start building your first automation

### Step 2: Basic Rule Structure

Every bot rule has 3 main parts:
- **Trigger**: When should this rule activate?
- **Response**: What message should be sent?
- **Actions** (optional): What should happen automatically?

---

## 🎯 Trigger Types Explained

### 1. **Keyword (Contains)**
Triggers when the message contains the keyword anywhere.

**Example:**
- **Trigger Value**: `hello`
- **Matches**: "Hello", "Hi hello", "hello there", "HELLO"
- **Use Case**: General greetings, FAQ keywords

---

### 2. **Exact Match**
Triggers only when the message exactly matches the trigger.

**Example:**
- **Trigger Value**: `help`
- **Matches**: "help" (exactly)
- **Doesn't Match**: "help me", "I need help"
- **Use Case**: Commands like "start", "menu", "cancel"

---

### 3. **Starts With**
Triggers when the message starts with the keyword.

**Example:**
- **Trigger Value**: `order`
- **Matches**: "order pizza", "order #123", "Order now"
- **Doesn't Match**: "I want to order", "my order"
- **Use Case**: Command-based interactions

---

### 4. **Ends With**
Triggers when the message ends with the keyword.

**Example:**
- **Trigger Value**: `price`
- **Matches**: "What's the price", "Tell me price", "product price"
- **Use Case**: Questions ending with specific words

---

### 5. **Match ANY Keyword**
Triggers if the message contains ANY of the comma-separated keywords.

**Example:**
- **Trigger Value**: `hello, hi, hey, good morning`
- **Matches**: Messages containing "hello" OR "hi" OR "hey" OR "good morning"
- **Use Case**: Multiple ways to say the same thing

---

### 6. **Match ALL Keywords**
Triggers only if the message contains ALL of the comma-separated keywords.

**Example:**
- **Trigger Value**: `order, pizza`
- **Matches**: "I want to order pizza", "order a large pizza"
- **Doesn't Match**: "order burger", "pizza menu"
- **Use Case**: Specific product/service combinations

---

### 7. **Regex Pattern**
Triggers based on a regular expression pattern.

**Examples:**
- **Trigger Value**: `^[0-9]+$` (matches only numbers)
- **Matches**: "123", "999", "0"
- **Doesn't Match**: "abc123", "12.5"

- **Trigger Value**: `^[A-Z0-9]+$` (matches alphanumeric codes)
- **Matches**: "ORDER123", "INV456"
- **Use Case**: Order numbers, invoice codes, tracking IDs

---

### 8. **All Messages**
Triggers for every incoming message (use with caution and high priority).

**Example:**
- **Use Case**: Logging all messages, global auto-responder
- **Note**: Set very high priority and use conditions to filter

---

### 9. **First Message**
Triggers only for the very first message from a new contact.

**Example:**
- **Use Case**: Welcome message for new customers
- **Trigger Value**: Not required (automatically detects first message)

---

### 10. **Message Type**
Triggers based on message type (image, document, audio, video).

**Example:**
- **Trigger Value**: `image`
- **Matches**: When user sends an image
- **Use Case**: "Thank you for sharing the image, we'll review it"

---

## 💬 Response Types Explained

### 1. **Text Message**
Simple text response with support for context variables.

**Example:**
```
Hi {{name}}! Welcome to our store.
Your last order was {{last_order}}.
Current balance: ₹{{balance}}
```

**Variables Available:**
- `{{name}}` - Customer name
- `{{phone}}` - Phone number
- `{{email}}` - Email address
- `{{last_order}}` - Last order number
- `{{balance}}` - Account balance

---

### 2. **Image**
Send an image with optional caption.

**Configuration:**
- **Media URL**: `https://example.com/promo.jpg`
- **Response Message**: "Check out our latest promotion!"

**Use Case**: Product images, promotional graphics, brochures

---

### 3. **Video**
Send a video with optional caption.

**Configuration:**
- **Media URL**: `https://example.com/demo.mp4`
- **Response Message**: "Watch our product demo!"

---

### 4. **Document/PDF**
Send a PDF or document file.

**Configuration:**
- **Media URL**: `https://example.com/catalog.pdf`
- **Response Message**: "Here's our product catalog"

**Use Case**: Catalogs, invoices, receipts, manuals

---

### 5. **Audio**
Send an audio file (voice note).

**Configuration:**
- **Media URL**: `https://example.com/welcome.mp3`
- **Response Message**: "Listen to our welcome message"

---

### 6. **Quick Buttons**
Interactive buttons (max 3 buttons).

**Configuration:**
```
Button 1:
  ID: opt1
  Title: Order Now

Button 2:
  ID: opt2
  Title: View Menu

Button 3:
  ID: opt3
  Title: Contact Us
```

**User Experience:**
User sees 3 clickable buttons. When they click a button, the system receives the button ID (opt1, opt2, or opt3).

**Use Case**: Quick actions, menu navigation

---

### 7. **List Message**
Dropdown list with multiple options.

**Configuration:**
```
Option 1:
  ID: cat1
  Title: Electronics
  Description: Phones, laptops, accessories

Option 2:
  ID: cat2
  Title: Clothing
  Description: Men's, women's, kids

Option 3:
  ID: cat3
  Title: Home & Kitchen
  Description: Appliances, furniture
```

**User Experience:**
User sees a list they can scroll through. They select an option, and the system receives the option ID.

**Use Case**: Categories, product selection, services

---

### 8. **Template Message**
WhatsApp Business template message (requires approval).

**Use Case**: Official notifications, OTPs, transactional messages

---

## 🌟 Real-World Examples

### Example 1: Welcome Bot for New Customers

**Goal**: Automatically welcome first-time customers and guide them.

**Rule 1: First Message Welcome**
- **Name**: "Welcome New Customer"
- **Trigger Type**: First Message
- **Priority**: 100
- **Response Type**: Text
- **Response Message**:
  ```
  Hi! 👋 Welcome to [Your Business Name]!
  
  I'm your automated assistant. Here's what I can help you with:
  
  1️⃣ Browse Products - Type "products"
  2️⃣ Check Prices - Type "price of [item]"
  3️⃣ Place Order - Type "order"
  4️⃣ Track Order - Type "track [order number]"
  5️⃣ Talk to Human - Type "agent"
  
  Just type any option number or keyword to get started!
  ```
- **Auto Actions**: 
  - Add Label: "New Customer"
  - Create Lead: Yes

**Rule 2: Help Command**
- **Name**: "Help Menu"
- **Trigger Type**: Exact Match
- **Trigger Value**: `help`
- **Priority**: 90
- **Response Type**: List Message
- **Response Options**:
  - ID: `help1`, Title: "Browse Products", Description: "View our catalog"
  - ID: `help2`, Title: "Track Order", Description: "Check order status"
  - ID: `help3`, Title: "Contact Support", Description: "Talk to an agent"
- **End Flow**: Yes

---

### Example 2: Order Placement Bot Flow

**Goal**: Guide customers through placing an order step-by-step.

**Rule 1: Order Start**
- **Name**: "Order Initiation"
- **Trigger Type**: Keyword (Contains)
- **Trigger Value**: `order`
- **Priority**: 80
- **Response Type**: Text
- **Response Message**: "Great! Let's place an order. Please send me the product name:"
- **Expected Input Type**: Text
- **Next Rule**: Rule 2 (Order - Product Selection)
- **Auto Actions**: Add Label: "Ordering"

**Rule 2: Order - Product Selection**
- **Name**: "Order - Product Selection"
- **Trigger Type**: All Messages
- **Priority**: 70
- **Conditions**: 
  - Required Label: "Ordering"
  - Conversation State: "waiting_product"
- **Response Type**: Text
- **Response Message**: "Got it! Product: {{product_name}}. How many units do you need?"
- **Expected Input Type**: Number
- **Next Rule**: Rule 3 (Order - Quantity)
- **Context Variables**: Extract `product_name` from message

**Rule 3: Order - Quantity**
- **Name**: "Order - Quantity"
- **Trigger Type**: All Messages
- **Priority**: 60
- **Conditions**: Conversation State: "waiting_quantity"
- **Response Type**: Text
- **Response Message**: "Perfect! {{quantity}} units of {{product_name}}. Your total is ₹{{total}}. Type 'confirm' to place the order or 'cancel' to start over."
- **Expected Input Type**: Yes/No
- **Fallback Message**: "Please type 'confirm' or 'cancel'"
- **Next Rule**: Rule 4 (Order - Confirmation)

**Rule 4: Order - Confirmation**
- **Name**: "Order - Confirmation"
- **Trigger Type**: Exact Match
- **Trigger Value**: `confirm`
- **Priority**: 50
- **Response Type**: Text
- **Response Message**: "✅ Order placed successfully! Order #{{order_number}}. We'll send you updates via WhatsApp. Thank you!"
- **Auto Actions**: 
  - Remove Label: "Ordering"
  - Add Label: "Customer"
  - Create Lead: Yes
  - Update CRM: Order Status = "Placed"
- **End Flow**: Yes

---

### Example 3: FAQ Bot

**Goal**: Automatically answer common questions.

**Rule 1: Store Hours**
- **Name**: "Store Hours FAQ"
- **Trigger Type**: Match ANY Keyword
- **Trigger Value**: `hours, timings, open, closed, when open`
- **Priority**: 75
- **Response Type**: Text
- **Response Message**: 
  ```
  🕐 Our Store Hours:
  
  Monday - Friday: 9:00 AM - 8:00 PM
  Saturday: 10:00 AM - 6:00 PM
  Sunday: Closed
  
  We're always here on WhatsApp! 💬
  ```
- **End Flow**: Yes

**Rule 2: Delivery Info**
- **Name**: "Delivery FAQ"
- **Trigger Type**: Match ANY Keyword
- **Trigger Value**: `delivery, shipping, courier, when will arrive`
- **Priority**: 75
- **Response Type**: Text
- **Response Message**: 
  ```
  🚚 Delivery Information:
  
  • Free delivery for orders above ₹500
  • Standard delivery: 2-3 business days
  • Express delivery: 1 day (₹50 extra)
  
  Track your order: Type "track [order number]"
  ```
- **End Flow**: Yes

**Rule 3: Return Policy**
- **Name**: "Return Policy FAQ"
- **Trigger Type**: Match ANY Keyword
- **Trigger Value**: `return, refund, exchange, replace`
- **Priority**: 75
- **Response Type**: Text
- **Response Message**: 
  ```
  🔄 Return & Refund Policy:
  
  • 7-day return window
  • Items must be unused and in original packaging
  • Refund processed within 5-7 business days
  
  To initiate return, type "return [order number]"
  ```
- **End Flow**: Yes

---

### Example 4: Lead Qualification Bot

**Goal**: Qualify leads automatically by asking questions.

**Rule 1: Lead Qualification Start**
- **Name**: "Lead Qualification - Start"
- **Trigger Type**: Match ANY Keyword
- **Trigger Value**: `interested, want to buy, pricing, quote`
- **Priority**: 85
- **Response Type**: Quick Buttons
- **Response Message**: "Great! I'd like to understand your needs better."
- **Response Options**:
  - ID: `budget_under_10k`, Title: "Under ₹10,000"
  - ID: `budget_10k_50k`, Title: "₹10,000 - ₹50,000"
  - ID: `budget_over_50k`, Title: "Above ₹50,000"
- **Next Rule**: Rule 2 (Lead Qualification - Budget)
- **Auto Actions**: Add Label: "Qualifying Lead"

**Rule 2: Lead Qualification - Budget**
- **Name**: "Lead Qualification - Budget"
- **Trigger Type**: All Messages
- **Priority**: 84
- **Conditions**: Required Label: "Qualifying Lead"
- **Response Type**: Text
- **Response Message**: "Perfect! Budget: {{budget_range}}. When are you planning to make the purchase?"
- **Next Rule**: Rule 3 (Lead Qualification - Timeline)
- **Context Variables**: Store `budget_range` from button selection

**Rule 3: Lead Qualification - Timeline**
- **Name**: "Lead Qualification - Timeline"
- **Trigger Type**: All Messages
- **Priority**: 83
- **Response Type**: Quick Buttons
- **Response Message**: "Timeline?"
- **Response Options**:
  - ID: `timeline_immediate`, Title: "Immediately"
  - ID: `timeline_week`, Title: "This Week"
  - ID: `timeline_month`, Title: "This Month"
- **Next Rule**: Rule 4 (Lead Qualification - Complete)

**Rule 4: Lead Qualification - Complete**
- **Name**: "Lead Qualification - Complete"
- **Trigger Type**: All Messages
- **Priority**: 82
- **Response Type**: Text
- **Response Message**: 
  ```
  ✅ Thank you for the information!
  
  Budget: {{budget_range}}
  Timeline: {{timeline}}
  
  One of our sales representatives will contact you shortly. 
  You'll receive a call within 24 hours.
  
  In the meantime, would you like to see our catalog? 
  Type "catalog" to browse.
  ```
- **Auto Actions**:
  - Remove Label: "Qualifying Lead"
  - Add Label: "Hot Lead" (if timeline is immediate)
  - Add Label: "Warm Lead" (if timeline is week/month)
  - Create Lead: Yes
  - Update CRM: Budget = {{budget_range}}, Timeline = {{timeline}}
- **End Flow**: Yes

---

### Example 5: Price Inquiry Bot

**Goal**: Automatically respond to price inquiries.

**Rule 1: Price Inquiry**
- **Name**: "Price Inquiry"
- **Trigger Type**: Match ANY Keyword
- **Trigger Value**: `price, cost, how much, pricing`
- **Priority**: 70
- **Response Type**: Text
- **Response Message**: 
  ```
  💰 Price Inquiry
  
  Please specify which product you're interested in, or type "catalog" to see all products and prices.
  
  Example: "price of laptop" or "how much is the iPhone"
  ```
- **Expected Input Type**: Text
- **Next Rule**: Rule 2 (Price Lookup)

**Rule 2: Price Lookup**
- **Name**: "Price Lookup"
- **Trigger Type**: Starts With
- **Trigger Value**: `price of`
- **Priority**: 65
- **Response Type**: Text
- **Response Message**: 
  ```
  Searching for: {{product_name}}
  
  🔍 Product Found:
  Name: {{product_name}}
  Price: ₹{{price}}
  Stock: {{stock_status}}
  
  Type "order {{product_name}}" to place an order.
  ```
- **Auto Actions**: 
  - Extract `product_name` from message
  - Lookup product in database
  - Store `price` and `stock_status` in context
- **End Flow**: Yes

---

### Example 6: Appointment Booking Bot

**Goal**: Allow customers to book appointments via WhatsApp.

**Rule 1: Appointment Booking Start**
- **Name**: "Appointment - Start"
- **Trigger Type**: Match ANY Keyword
- **Trigger Value**: `appointment, book, schedule, visit`
- **Priority**: 80
- **Response Type**: Quick Buttons
- **Response Message**: "What type of appointment would you like to book?"
- **Response Options**:
  - ID: `appt_consultation`, Title: "Consultation"
  - ID: `appt_service`, Title: "Service"
  - ID: `appt_followup`, Title: "Follow-up"
- **Next Rule**: Rule 2 (Appointment - Type Selected)
- **Auto Actions**: Add Label: "Booking Appointment"

**Rule 2: Appointment - Date Selection**
- **Name**: "Appointment - Date"
- **Trigger Type**: All Messages
- **Priority**: 79
- **Response Type**: Text
- **Response Message**: 
  ```
  Appointment Type: {{appointment_type}}
  
  Please send your preferred date in DD/MM/YYYY format.
  Example: 25/12/2024
  ```
- **Expected Input Type**: Text (date validation)
- **Fallback Message**: "Please send date in DD/MM/YYYY format (e.g., 25/12/2024)"
- **Next Rule**: Rule 3 (Appointment - Time Selection)

**Rule 3: Appointment - Time Selection**
- **Name**: "Appointment - Time"
- **Trigger Type**: All Messages
- **Priority**: 78
- **Response Type**: Quick Buttons
- **Response Message**: "Available time slots for {{date}}:"
- **Response Options**:
  - ID: `time_9am`, Title: "9:00 AM"
  - ID: `time_11am`, Title: "11:00 AM"
  - ID: `time_2pm`, Title: "2:00 PM"
  - ID: `time_4pm`, Title: "4:00 PM"
- **Next Rule**: Rule 4 (Appointment - Confirm)

**Rule 4: Appointment - Confirm**
- **Name**: "Appointment - Confirm"
- **Trigger Type**: All Messages
- **Priority**: 77
- **Response Type**: Text
- **Response Message**: 
  ```
  ✅ Appointment Booked!
  
  Type: {{appointment_type}}
  Date: {{date}}
  Time: {{time}}
  
  Appointment ID: {{appointment_id}}
  
  You'll receive a reminder 1 day before your appointment.
  To cancel, reply "cancel {{appointment_id}}"
  ```
- **Auto Actions**:
  - Remove Label: "Booking Appointment"
  - Add Label: "Has Appointment"
  - Create Lead: Yes
  - Schedule Follow-up: 1 day before appointment
- **End Flow**: Yes

---

## 🔗 Message Chaining & Flows

### How Chaining Works

1. **Next Rule ID**: When a rule completes, it can automatically move to another rule
2. **Expected Input**: Define what type of input you're expecting (text, number, email, etc.)
3. **Fallback Message**: What to send if the input is invalid
4. **End Flow**: Mark a rule as the end of the conversation flow

### Chaining Example: Order Flow

```
Rule 1 (Order Start)
    ↓ [User types product name]
Rule 2 (Product Selected)
    ↓ [User types quantity]
Rule 3 (Quantity Entered)
    ↓ [User types "confirm"]
Rule 4 (Order Confirmed) [END FLOW]
```

### Chaining with Buttons/Lists

When using buttons or lists, you can create separate chains for each option:

```
Rule 1 (Main Menu - Buttons)
    ├─→ [Option 1] → Rule 2A (Products)
    ├─→ [Option 2] → Rule 2B (Services)
    └─→ [Option 3] → Rule 2C (Support)
```

**Configuration:**
- In Rule 1, set up buttons
- Create Rule 2A, 2B, 2C for each option
- Use "Auto Actions" → "Chain Mappings" to link button IDs to next rules

---

## 🎛️ Advanced Features

### 1. Conditions & Filters

**Required Labels:**
- Rule only triggers if conversation has ALL specified labels
- Example: Only respond to "VIP" customers

**Excluded Labels:**
- Rule won't trigger if conversation has ANY of these labels
- Example: Don't auto-respond to conversations labeled "Escalated to Human"

**Minimum Inactivity:**
- Only trigger if user hasn't messaged in X minutes
- Example: Send follow-up after 1 hour of inactivity

**Sender Types:**
- Filter by individual chats or group chats
- Example: Different responses for group vs individual

---

### 2. Auto Actions

**Add Labels:**
- Automatically add labels when rule triggers
- Example: Mark as "Interested" when they ask about pricing

**Remove Labels:**
- Automatically remove labels
- Example: Remove "New Customer" after first purchase

**Create Lead:**
- Automatically create a lead in your CRM
- Example: When someone shows interest in your products

**Send Follow-up:**
- Schedule a follow-up message after X minutes
- Example: Remind about abandoned cart after 30 minutes

**Save Context:**
- Extract and store information from messages
- Example: Save customer's budget preference for later use

---

### 3. Context Variables

**Extract Variables:**
Configure which variables to extract from messages:
- `name`, `phone`, `email`, `budget`, `product_name`, etc.

**Use in Messages:**
Use `{{variable_name}}` in response messages:
```
Hi {{name}}! Your order {{order_number}} is ready.
Total amount: ₹{{total}}
```

**Store for Later:**
Variables are stored in conversation context and can be used in subsequent rules in the same conversation.

---

### 4. Priority System

Rules are checked in **priority order** (higher priority = checked first).

**Best Practice:**
- Specific rules: Priority 90-100
- General rules: Priority 50-80
- Fallback/default: Priority 0-10

**Example:**
```
Priority 100: First Message (very specific)
Priority 90:  Exact match "help" (specific command)
Priority 80:  Keyword "order" (common action)
Priority 70:  Keyword "price" (common question)
Priority 10:  Default fallback (catch-all)
```

---

## ✅ Best Practices

### 1. **Start Simple**
Begin with basic keyword triggers and text responses. Add complexity gradually.

### 2. **Use High Priority for Specific Rules**
Exact matches and first messages should have higher priority than general keywords.

### 3. **Always Set "End Flow"**
For standalone responses, mark "End Flow" to prevent unexpected chaining.

### 4. **Use Labels Strategically**
Labels help segment conversations and enable conditional rules.

### 5. **Test Your Flows**
- Create test rules
- Send test messages
- Verify the flow works as expected
- Check auto actions are triggered

### 6. **Provide Fallback Messages**
When expecting specific input (email, number, date), always provide a fallback message for invalid input.

### 7. **Use Categories**
Organize rules by category (Welcome, FAQ, Order, Support) for easier management.

### 8. **Monitor and Iterate**
- Review conversation logs
- Identify common questions not covered
- Update rules based on customer behavior

### 9. **Avoid Infinite Loops**
- Always have an "End Flow" in your chains
- Use "End Flow" for standalone responses
- Test your chains to ensure they terminate

### 10. **Combine with Human Handoff**
- Use label "Escalated" to stop bot responses
- Allow users to type "agent" or "human" to talk to a real person
- Auto-assign conversations to team members for complex issues

---

## 🔧 Common Patterns

### Pattern 1: Menu Navigation

```
Main Menu (Buttons)
    ├─ Products → Product Menu
    ├─ Services → Service Menu
    └─ Support → Support Flow

Product Menu (List)
    ├─ Electronics → Product Details
    ├─ Clothing → Product Details
    └─ Home & Kitchen → Product Details
```

### Pattern 2: Data Collection

```
Start → Ask Name → Ask Phone → Ask Email → Confirm → End
```

Each step stores the collected data in context variables.

### Pattern 3: Conditional Responses

```
Price Inquiry
    ├─ If product exists → Show Price
    └─ If product doesn't exist → Suggest Similar Products
```

Use conditions and multiple rules with different priorities.

### Pattern 4: Follow-up Sequences

```
Welcome Message
    ↓ (After 1 hour if no response)
Follow-up: "Still need help?"
    ↓ (After 1 day if no response)
Final Follow-up: "We're here if you need us!"
```

Use "Send Follow-up After X minutes" in auto actions.

---

## 📊 Example: Complete E-commerce Bot Setup

### Rules Overview:

1. **First Message Welcome** (Priority: 100)
   - Trigger: First Message
   - Response: Welcome with menu
   - Actions: Add "New Customer" label

2. **Product Inquiry** (Priority: 90)
   - Trigger: Keyword "products" or "catalog"
   - Response: Product categories (List Message)

3. **Price Inquiry** (Priority: 85)
   - Trigger: Starts with "price of"
   - Response: Product price lookup
   - Actions: Add "Price Inquiry" label

4. **Order Placement** (Priority: 80)
   - Trigger: Keyword "order"
   - Response: Order flow start
   - Chain: Multi-step order process

5. **Track Order** (Priority: 75)
   - Trigger: Starts with "track"
   - Response: Order status lookup

6. **FAQ - Delivery** (Priority: 70)
   - Trigger: Match ANY "delivery, shipping, courier"
   - Response: Delivery information

7. **FAQ - Returns** (Priority: 70)
   - Trigger: Match ANY "return, refund, exchange"
   - Response: Return policy

8. **Help Menu** (Priority: 65)
   - Trigger: Exact match "help"
   - Response: Help options (Buttons)

9. **Human Agent** (Priority: 60)
   - Trigger: Match ANY "agent, human, talk to person"
   - Response: "Connecting you to an agent..."
   - Actions: Add "Escalated" label, Remove auto-response labels

10. **Default Fallback** (Priority: 10)
    - Trigger: All Messages
    - Conditions: Not labeled "Escalated"
    - Response: "I didn't understand. Type 'help' for options."

---

## 🎓 Quick Reference Card

### Trigger Types Quick Guide:
- **Specific commands**: Exact Match
- **Questions**: Starts With or Ends With
- **Topics**: Keyword (Contains)
- **Multiple ways to say same thing**: Match ANY Keyword
- **Complex requirements**: Match ALL Keywords
- **Patterns/codes**: Regex
- **New contacts**: First Message
- **Everything**: All Messages (use with conditions!)

### Response Types Quick Guide:
- **Simple replies**: Text
- **Media sharing**: Image, Video, Document, Audio
- **Quick actions**: Quick Buttons (max 3)
- **Multiple choices**: List Message (unlimited)
- **Official messages**: Template Message

### Priority Guidelines:
- **100**: First message, critical commands
- **90-95**: Specific commands (help, menu, cancel)
- **80-89**: Common actions (order, track, inquiry)
- **70-79**: FAQ responses
- **50-69**: General keyword matches
- **10-49**: Default/fallback responses
- **0-9**: Catch-all rules

---

## 🚨 Troubleshooting

### Rule Not Triggering?
1. Check if rule is **Active**
2. Verify **Priority** (higher priority rules checked first)
3. Check **Conditions** (labels, sender type)
4. Verify **Trigger Value** matches test message exactly
5. Check if another rule with higher priority is catching it first

### Chaining Not Working?
1. Verify **Next Rule ID** is set correctly
2. Check if **End Flow** is set (prevents chaining)
3. Ensure conversation state is correct
4. Verify expected input type matches user's input

### Auto Actions Not Executing?
1. Check action configuration
2. Verify labels exist before trying to add/remove
3. Check database/logs for errors
4. Ensure business has permission for CRM actions

---

## 💡 Pro Tips

1. **Use Emojis**: Make messages more engaging with emojis
2. **Personalize**: Use `{{name}}` and other variables
3. **Keep It Short**: WhatsApp messages are best when concise
4. **Test on Mobile**: Test your bot on actual WhatsApp mobile app
5. **Monitor Analytics**: Track which rules trigger most often
6. **A/B Testing**: Create multiple versions of rules and test which performs better
7. **Regular Updates**: Update rules based on customer feedback
8. **Document Your Flows**: Keep a diagram of your conversation flows
9. **Backup Rules**: Export/backup your rules before major changes
10. **Team Training**: Train your team on how the bot works so they can help customers

---

## 📞 Support

If you need help setting up bot rules:
1. Check this guide first
2. Review the example flows above
3. Start with simple rules and build complexity
4. Test thoroughly before going live

---

**Happy Bot Building! 🤖✨**

