# Preview Mode for AI Assistant Settings - Design Documentation

## Overview

Preview Mode allows users to test how their AI assistant responds to customer messages without sending real messages or modifying data. It provides a safe testing environment where users can see sample interactions and adjust settings accordingly.

## UI Flow

### 1. Page Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ AI Assistant Settings                                           │
│                                                                 │
│ [Configuration Sections]                                        │
│ - Business Type                                                 │
│ - Communication Style                                           │
│ - Customer Handling                                             │
│ - Offers & Promotions                                           │
│ - Product Information Display                                   │
│ - Business Hours                                                │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Preview Mode                                                    │
│ ─────────────                                                   │
│                                                                 │
│ ℹ️ Preview Mode - Safe Testing                                  │
│ Preview mode allows you to test how your AI assistant           │
│ responds without sending real messages or modifying data.       │
│                                                                 │
│ • No messages are sent to customers                             │
│ • No data is modified or saved                                  │
│ • No API costs are incurred                                     │
│                                                                 │
│ [Reset to Defaults] [Clear Preview]                            │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Sample Questions                                                │
│ ────────────────                                                │
│                                                                 │
│ [Hello, I need help]  [What products do you have?]             │
│ [What are your prices?]  [I want to place an order]            │
│ [Any discounts available?]  [Tell me about your business]      │
│                                                                 │
│ Or type your own question:                                      │
│ [_______________________________________________] [Send]        │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Conversation Preview                                            │
│ ────────────────────                                            │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────┐    │
│ │ Customer                                                 │    │
│ │ Hello, I need help                                       │    │
│ │ 10:30 AM                                                 │    │
│ └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────┐    │
│ │ AI Assistant                                             │    │
│ │ Hi there! 👋 Thanks for reaching out. I'm here to help  │    │
│ │ with any questions about our products or services.       │    │
│ │ What can I do for you?                                   │    │
│ │ 10:30 AM                                                 │    │
│ └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Component Structure

```
SettingsPage
  └─ ConfigurationSections (all config sections)
  └─ PreviewModeSection
      ├─ SafeModeInfo (info box with explanation)
      ├─ PreviewControls (Reset to Defaults, Clear Preview)
      ├─ SampleQuestions (clickable question buttons)
      ├─ CustomInput (text input for custom questions)
      └─ PreviewConversation
          └─ MessageList
              ├─ CustomerMessage (user messages)
              └─ AIMessage (AI responses)
```

### 3. User Interaction Flow

```
1. User lands on settings page
   ↓
2. User configures settings (e.g., tone, response length)
   ↓
3. User clicks on a sample question OR types custom question
   ↓
4. Preview mode:
   a. Adds customer message to preview conversation
   b. Shows loading indicator on AI message
   c. Generates preview response based on current config
   d. Displays AI response in preview conversation
   ↓
5. User can:
   - Click more sample questions to continue conversation
   - Type custom questions
   - Adjust settings and see response change
   - Reset to defaults
   - Clear preview conversation
```

## State Management Approach

### 1. Preview State Structure

```typescript
interface PreviewState {
  messages: PreviewMessage[];          // Conversation messages
  isGenerating: boolean;                // Is AI response being generated
  currentConfig: Partial<WhatsAppBotUIConfig> | null;  // Current config snapshot
  selectedQuestion: string | null;     // Currently selected sample question
  hasInteracted: boolean;              // Has user interacted with preview
}
```

### 2. State Updates

#### Adding Customer Message
```typescript
function addCustomerMessage(text: string) {
  setPreviewState(prev => ({
    ...prev,
    messages: [
      ...prev.messages,
      {
        id: generateId(),
        type: 'customer',
        content: text,
        timestamp: new Date(),
      }
    ],
    hasInteracted: true,
  }));
}
```

#### Generating AI Response
```typescript
async function generateAIResponse(config: Partial<WhatsAppBotUIConfig>) {
  const lastCustomerMessage = getLastCustomerMessage();
  if (!lastCustomerMessage) return;
  
  // Add loading message
  const loadingMessageId = generateId();
  setPreviewState(prev => ({
    ...prev,
    isGenerating: true,
    messages: [
      ...prev.messages,
      {
        id: loadingMessageId,
        type: 'ai',
        content: '',
        timestamp: new Date(),
        isLoading: true,
      }
    ],
    currentConfig: config,
  }));
  
  // Generate preview response (mock/simulated)
  const response = await generatePreviewResponse(
    lastCustomerMessage.content,
    config
  );
  
  // Replace loading message with actual response
  setPreviewState(prev => ({
    ...prev,
    isGenerating: false,
    messages: prev.messages.map(msg =>
      msg.id === loadingMessageId
        ? { ...msg, content: response, isLoading: false }
        : msg
    ),
  }));
}
```

#### Resetting to Defaults
```typescript
function resetToDefaults() {
  const defaultConfig = getDefaultPreviewConfig();
  setPreviewState(prev => ({
    ...prev,
    currentConfig: defaultConfig,
    messages: [],
    selectedQuestion: null,
    hasInteracted: false,
  }));
  
  // Also reset actual config if needed
  onConfigChange?.(defaultConfig);
}
```

#### Clearing Preview
```typescript
function clearPreview() {
  setPreviewState(prev => ({
    ...prev,
    messages: [],
    selectedQuestion: null,
    hasInteracted: false,
  }));
}
```

### 3. Configuration Change Handling

```typescript
// When user changes settings
useEffect(() => {
  if (previewState.hasInteracted && previewState.messages.length > 0) {
    // Regenerate last AI response with new config
    const lastCustomerMessage = getLastCustomerMessage();
    if (lastCustomerMessage) {
      generateAIResponse(currentConfig);
    }
  }
}, [currentConfig]);
```

### 4. State Persistence

```typescript
// Optional: Save preview state to localStorage for persistence
useEffect(() => {
  if (previewState.hasInteracted) {
    localStorage.setItem('previewState', JSON.stringify(previewState));
  }
}, [previewState]);

// Load on mount
useEffect(() => {
  const saved = localStorage.getItem('previewState');
  if (saved) {
    setPreviewState(JSON.parse(saved));
  }
}, []);
```

## Preview Response Generation

### 1. Mock Response Generator

The preview mode uses a simplified response generator that:
- Doesn't call the real AI API (no costs)
- Doesn't access real database data (safe)
- Simulates responses based on configuration
- Uses the same tone and response length settings

### 2. Response Categories

Preview responses are generated based on message content:

- **Greetings:** "Hello", "Hi", "Help"
- **Product Inquiries:** "Product", "Item", "Do you have"
- **Pricing:** "Price", "Cost", "Discount"
- **Orders:** "Order", "Buy", "Purchase"
- **Default:** Fallback response

### 3. Configuration Influence

Preview responses respect:
- **Tone:** friendly_casual, professional_formal, etc.
- **Response Length:** brief, moderate, detailed
- **Offers/Promotions:** Auto-mention settings
- **Customer Handling:** Greeting styles

### 4. Response Generation Flow

```
Customer Message
    ↓
Detect Message Category
    ↓
Get Current Configuration
    ↓
Select Response Template (based on tone + length)
    ↓
Apply Configuration Rules (offers, customer handling, etc.)
    ↓
Generate Preview Response
    ↓
Display in Preview Conversation
```

## Safe Mode Explanation

### Information Display

The safe mode explanation should be prominently displayed with:

1. **Title:** "Preview Mode - Safe Testing"
2. **Description:** Brief explanation of what preview mode does
3. **Key Points:**
   - No messages are sent to customers
   - No data is modified or saved
   - No API costs are incurred
   - Preview responses are based on current settings
   - Can test different configurations safely

4. **Warnings:**
   - Preview responses are simulated and may differ from actual AI responses
   - Product data shown is from actual catalog (read-only)
   - Preview does not include real-time data like inventory or pricing

### Visual Treatment

- Info icon (ℹ️) or safety icon (🛡️)
- Light background color (e.g., blue-50, green-50)
- Clear, concise text
- Optional: Collapsible/expandable section

## Reset to Defaults Button

### Functionality

1. **Resets Configuration:**
   - Sets all settings to default values
   - Updates preview state to use default config

2. **Clears Preview (Optional):**
   - Can optionally clear preview conversation
   - Or keep conversation but regenerate responses

3. **Confirmation (Optional):**
   - For destructive reset, show confirmation dialog
   - For preview-only reset, immediate action

### Button States

- **Default:** "Reset to Defaults"
- **Loading:** "Resetting..." (if async operation)
- **Disabled:** When no changes made

## Implementation Considerations

### 1. Performance

- **Lazy Loading:** Only load preview mode when user interacts
- **Debouncing:** Debounce config changes before regenerating preview
- **Memoization:** Cache preview responses for same config + message

### 2. User Experience

- **Smooth Transitions:** Animate message additions
- **Loading States:** Show loading indicators during generation
- **Error Handling:** Handle errors gracefully (show error message)
- **Empty State:** Show helpful message when no preview messages

### 3. Accessibility

- **Keyboard Navigation:** Support keyboard for sample questions
- **Screen Readers:** Proper ARIA labels for preview conversation
- **Focus Management:** Focus new messages when added
- **Color Contrast:** Ensure readable text colors

### 4. Edge Cases

- **Max Messages:** Limit preview conversation length (e.g., 20 messages)
- **Long Responses:** Truncate or scroll for very long responses
- **Config Changes:** Handle config changes during generation
- **Empty Config:** Handle missing/empty configuration

## Integration Points

### With Settings Configuration

- **Read:** Current configuration values
- **Write:** Reset to defaults (if allowed)
- **Watch:** Configuration changes trigger preview updates

### With Chatbot Service

- **Preview Generator:** Uses simplified version of chatbot logic
- **No API Calls:** Preview doesn't call real AI API
- **No Data Modification:** Preview doesn't modify database

### With UI Components

- **Message Components:** Reuse existing message UI components
- **Button Components:** Use standard button components
- **Input Components:** Use standard input components

## Example Usage

```typescript
// In settings page component
const [previewState, setPreviewState] = useState<PreviewState>({
  messages: [],
  isGenerating: false,
  currentConfig: null,
  selectedQuestion: null,
  hasInteracted: false,
});

// Handle sample question click
function handleSampleQuestionClick(question: SampleQuestion) {
  addCustomerMessage(question.text);
  generateAIResponse(currentConfig);
}

// Handle custom input
function handleCustomInputSubmit(text: string) {
  if (!text.trim()) return;
  addCustomerMessage(text);
  generateAIResponse(currentConfig);
}

// Handle reset
function handleResetToDefaults() {
  const defaultConfig = getDefaultPreviewConfig();
  setCurrentConfig(defaultConfig);
  resetPreview();
}
```

## Design Principles

### ✅ Safety First
- Clear labeling as "Preview"
- No real messages sent
- No data modification
- Safe mode explanation visible

### ✅ User-Friendly
- Simple, intuitive interface
- Sample questions for quick testing
- Custom input for flexibility
- Clear visual feedback

### ✅ Performance
- Fast response generation (mock)
- Smooth interactions
- No unnecessary API calls
- Efficient state management

### ✅ Informative
- Show how settings affect responses
- Real-time preview updates
- Clear safe mode explanation
- Helpful sample questions
