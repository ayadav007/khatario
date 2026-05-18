# 🤖 WhatsApp Bot Rules - Quick Reference

## 🎯 Trigger Types (When Rule Activates)

| Trigger Type | Example Value | Matches | Use Case |
|--------------|---------------|---------|----------|
| **Keyword (Contains)** | `hello` | "hello", "hi hello", "HELLO" | General keywords |
| **Exact Match** | `help` | "help" (exactly) | Commands |
| **Starts With** | `order` | "order pizza", "Order now" | Commands |
| **Ends With** | `price` | "what's the price" | Questions |
| **Match ANY** | `hello, hi, hey` | Contains ANY keyword | Multiple synonyms |
| **Match ALL** | `order, pizza` | Contains ALL keywords | Specific combinations |
| **Regex** | `^[0-9]+$` | Pattern match | Order numbers, codes |
| **All Messages** | (none) | Every message | Logging, default |
| **First Message** | (none) | First contact | Welcome message |
| **Message Type** | `image` | Media type | Image/document handling |

---

## 💬 Response Types (What to Send)

| Response Type | Max Options | Example Use |
|---------------|-------------|-------------|
| **Text** | - | Simple messages, use `{{variables}}` |
| **Image** | - | Product photos, promotions |
| **Video** | - | Product demos, tutorials |
| **Document/PDF** | - | Catalogs, invoices |
| **Audio** | - | Voice messages |
| **Quick Buttons** | 3 buttons | Quick actions, yes/no |
| **List Message** | Unlimited | Categories, products |
| **Template** | - | Official notifications |

---

## 🔗 Message Chaining (Flow Control)

```
Rule 1 → Next Rule: Rule 2
    ↓ User responds
Rule 2 → Next Rule: Rule 3
    ↓ User responds
Rule 3 → End Flow: Yes
```

**Settings:**
- **Next Rule ID**: Select next rule in chain
- **Expected Input**: text, number, email, phone, yes/no, menu_option
- **Fallback Message**: Message for invalid input
- **End Flow**: Check to end conversation flow

---

## 🎛️ Conditions (Filter Messages)

| Condition | Example | Purpose |
|-----------|---------|---------|
| **Required Labels** | Must have "VIP" label | Only for specific segments |
| **Excluded Labels** | Must NOT have "Escalated" | Avoid auto-responding |
| **Min Inactivity** | 60 minutes | Follow-up after silence |
| **Sender Types** | Individual only | Different for groups |
| **Conversation State** | "waiting_order" | Multi-step flows |

---

## ⚡ Auto Actions (What Happens Automatically)

| Action | Example | Purpose |
|--------|---------|---------|
| **Add Label** | "Interested", "VIP" | Tag conversations |
| **Remove Label** | "New Customer" | Update status |
| **Create Lead** | Yes | Add to CRM |
| **Follow-up** | After 30 minutes | Remind customers |
| **Save Context** | `budget: {{message}}` | Store data |

---

## 📊 Priority System

**Higher Priority = Checked First**

```
Priority 100: First Message, Critical Commands
Priority 90-95: Specific Commands (help, menu, cancel)
Priority 80-89: Common Actions (order, track)
Priority 70-79: FAQ Responses
Priority 50-69: General Keywords
Priority 10-49: Default Responses
Priority 0-9: Catch-all
```

---

## 🎨 Context Variables

**Extract from messages:**
```
name, phone, email, budget, product_name, order_number
```

**Use in responses:**
```
Hi {{name}}! Your order {{order_number}} is ready.
Total: ₹{{total}}
```

---

## 📝 Common Patterns

### Pattern 1: Welcome Flow
```
First Message → Welcome with Menu → End Flow
```

### Pattern 2: Order Flow
```
Order Start → Product Selection → Quantity → Confirm → End
```

### Pattern 3: FAQ Response
```
Keyword Match → Answer Question → End Flow
```

### Pattern 4: Lead Qualification
```
Interest Detected → Budget Question → Timeline → Complete → End
```

---

## ✅ Quick Setup Checklist

- [ ] Create "First Message" welcome rule (Priority 100)
- [ ] Set up FAQ rules (Priority 70-80)
- [ ] Create common action flows (Priority 80-90)
- [ ] Add "Help" menu rule (Priority 90)
- [ ] Set up "Human Agent" escalation (Priority 60)
- [ ] Create default fallback rule (Priority 10)
- [ ] Test each rule thoroughly
- [ ] Set appropriate labels for segmentation
- [ ] Configure auto actions for important flows
- [ ] Enable rules one by one, monitor performance

---

## 🚨 Common Issues & Fixes

| Issue | Solution |
|-------|----------|
| Rule not triggering | Check priority, conditions, trigger value |
| Chaining not working | Verify Next Rule ID, check End Flow setting |
| Invalid input errors | Add Fallback Message |
| Multiple rules trigger | Adjust priorities, be more specific |
| Auto actions fail | Check labels exist, verify permissions |

---

**For detailed examples, see `WHATSAPP_BOT_RULES_GUIDE.md`**

