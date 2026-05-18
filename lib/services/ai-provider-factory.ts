// AI Provider Factory - Abstraction layer for multiple AI providers
// Supports: OpenAI, Google Gemini, Groq, Custom APIs

import { queryOne } from '@/lib/db';

// Supported AI providers
export type AIProvider = 'openai' | 'gemini' | 'groq' | 'anthropic' | 'custom';

export interface AIProviderConfig {
  provider: AIProvider;
  apiKey: string;
  apiBaseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

// Base interface for all AI providers
export interface AIProviderInterface {
  chat(messages: ChatMessage[]): Promise<AIResponse>;
  chatJSON(messages: ChatMessage[]): Promise<any>; // For structured responses
  analyzeImage(imageUrl: string, prompt: string): Promise<string>; // For vision/OCR
}

// OpenAI Provider
class OpenAIProvider implements AIProviderInterface {
  constructor(private config: AIProviderConfig) {}

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model || 'gpt-3.5-turbo',
        messages: messages,
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || '',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  async chatJSON(messages: ChatMessage[]): Promise<any> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model || 'gpt-3.5-turbo',
        messages: messages,
        temperature: this.config.temperature || 0.3,
        max_tokens: this.config.maxTokens || 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{}';
    return JSON.parse(content);
  }

  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model || 'gpt-4o', // Use GPT-4o by default for vision
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
        max_tokens: this.config.maxTokens || 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Vision API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }
}

// Google Gemini Provider
class GeminiProvider implements AIProviderInterface {
  constructor(private config: AIProviderConfig) {}

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    // Convert messages to Gemini format
    const contents: any[] = [];
    let systemInstruction = '';

    messages.forEach(msg => {
      if (msg.role === 'system') {
        systemInstruction = msg.content;
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    });

    const requestBody: any = {
      contents: contents,
      generationConfig: {
        temperature: this.config.temperature || 0.7,
        maxOutputTokens: this.config.maxTokens || 500,
      },
    };

    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model || 'gemini-pro'}:generateContent?key=${this.config.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    };
  }

  async chatJSON(messages: ChatMessage[]): Promise<any> {
    // Add instruction to return JSON
    const jsonMessages: ChatMessage[] = [
      ...messages,
      {
        role: 'user',
        content: 'Please respond with valid JSON only, no additional text.',
      },
    ];

    const response = await this.chat(jsonMessages);
    try {
      return JSON.parse(response.content);
    } catch {
      // Try to extract JSON from response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Failed to parse JSON response from Gemini');
    }
  }

  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    // Determine model (flash is better/cheaper for simple vision)
    const model = this.config.model || 'gemini-1.5-flash';
    
    // For Gemini, we need to handle the image. 
    // If it's a URL, we need to fetch it and convert to base64 for inline_data
    // or use file API. For simplicity here, we'll try to fetch and send as inline_data.
    
    try {
      const imgResponse = await fetch(imageUrl);
      const buffer = await imgResponse.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const mimeType = imgResponse.headers.get('content-type') || 'image/jpeg';

      const requestBody = {
        contents: [{
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64
              }
            }
          ]
        }],
        generationConfig: {
          maxOutputTokens: this.config.maxTokens || 1000,
        }
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini Vision API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (error: any) {
      throw new Error(`Gemini Vision analysis failed: ${error.message}`);
    }
  }
}

// Groq Provider
class GroqProvider implements AIProviderInterface {
  constructor(private config: AIProviderConfig) {}

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model || 'llama-3.1-8b-instant',
        messages: messages,
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || '',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  async chatJSON(messages: ChatMessage[]): Promise<any> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model || 'llama-3.1-8b-instant',
        messages: messages,
        temperature: this.config.temperature || 0.3,
        max_tokens: this.config.maxTokens || 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{}';
    return JSON.parse(content);
  }

  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    throw new Error('Groq provider does not support vision yet');
  }
}

// Custom Provider (for custom API endpoints)
class CustomProvider implements AIProviderInterface {
  constructor(private config: AIProviderConfig) {}

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    if (!this.config.apiBaseUrl) {
      throw new Error('Custom provider requires apiBaseUrl');
    }

    const response = await fetch(this.config.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages,
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Custom API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    // Assume OpenAI-compatible response format
    return {
      content: data.choices?.[0]?.message?.content || data.content || '',
    };
  }

  async chatJSON(messages: ChatMessage[]): Promise<any> {
    const response = await this.chat(messages);
    try {
      return JSON.parse(response.content);
    } catch {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Failed to parse JSON response');
    }
  }

  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    // Assume custom provider might support OpenAI-compatible vision if it's based on it
    const response = await fetch(this.config.apiBaseUrl!, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
        max_tokens: this.config.maxTokens || 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Custom Vision API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || data.content || '';
  }
}


// Factory function to get provider instance
export async function getAIProvider(businessId: string): Promise<AIProviderInterface | null> {
  try {
    const config = await queryOne<{
      provider: string;
      api_key: string;
      api_base_url?: string;
      model?: string;
      temperature?: number;
      max_tokens?: number;
      chatbot_enabled?: boolean;
    }>(
      `SELECT provider, api_key, api_base_url, model, temperature, max_tokens, chatbot_enabled
       FROM ai_provider_config 
       WHERE business_id = $1`,
      [businessId]
    );

    if (!config) {
      console.log('[AI Provider Factory] ⚠️ No AI config found for business:', businessId);
      return null;
    }
    
    // chatbot_enabled defaults to true, so only block if explicitly false
    if (config.chatbot_enabled === false) {
      console.log('[AI Provider Factory] ⚠️ AI chatbot is disabled for business:', businessId);
      return null;
    }
    
    console.log('[AI Provider Factory] ✅ AI config found:', {
      businessId,
      provider: config.provider,
      hasApiKey: !!config.api_key,
      chatbot_enabled: config.chatbot_enabled,
      model: config.model
    });

    const providerConfig: AIProviderConfig = {
      provider: config.provider as AIProvider,
      apiKey: config.api_key,
      apiBaseUrl: config.api_base_url || undefined,
      model: config.model || undefined,
      temperature: config.temperature ? parseFloat(config.temperature.toString()) : undefined,
      maxTokens: config.max_tokens || undefined,
    };

    switch (config.provider) {
      case 'openai':
        return new OpenAIProvider(providerConfig);
      case 'gemini':
        return new GeminiProvider(providerConfig);
      case 'groq':
        return new GroqProvider(providerConfig);
      case 'custom':
        return new CustomProvider(providerConfig);
      default:
        console.warn(`Unsupported AI provider: ${config.provider}`);
        return null;
    }
  } catch (error) {
    console.error('Error getting AI provider:', error);
    return null;
  }
}
