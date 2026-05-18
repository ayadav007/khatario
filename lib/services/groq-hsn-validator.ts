interface HSNValidationRequest {
  productName: string;
  category?: string;
  existingHSN?: string;
  existingRate?: number;
}

interface HSNSuggestion {
  code: string;
  description: string;
  rate: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  warnings: string[];
  isService: boolean;
  useCase?: string;
}

interface HSNValidationResponse {
  suggestions: HSNSuggestion[];
}

interface GroqResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class GroqHSNValidator {
  private apiKey: string;
  private apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
  private model = 'llama-3.1-8b-instant'; // Fast and reliable model for structured tasks

  constructor() {
    this.apiKey = process.env.GROQ_API_KEY || '';
    if (!this.apiKey) {
      console.warn('GROQ_API_KEY not found in environment variables');
    }
  }

  async validateHSN(request: HSNValidationRequest): Promise<HSNValidationResponse | null> {
    if (!this.apiKey) {
      return null;
    }

    try {
      const prompt = this.buildPrompt(request);
      const response = await this.callGroqAPI(prompt);
      return this.parseResponse(response, request);
    } catch (error) {
      console.error('Groq API Error:', error);
      return null;
    }
  }

  // Backward compatibility: Get first suggestion
  async getFirstSuggestion(request: HSNValidationRequest): Promise<HSNSuggestion | null> {
    const response = await this.validateHSN(request);
    if (response && response.suggestions.length > 0) {
      return response.suggestions[0];
    }
    return null;
  }

  // Get GST rates for specific HSN/SAC codes (codes already validated from database)
  async getRatesForCodes(codes: string[], productName?: string): Promise<Map<string, HSNSuggestion>> {
    if (!this.apiKey || codes.length === 0) {
      return new Map();
    }

    try {
      // Build prompt to get rates for specific codes
      const prompt = this.buildRatePrompt(codes, productName);
      const response = await this.callGroqAPI(prompt);
      const parsed = this.parseRateResponse(response, codes);
      
      return parsed;
    } catch (error) {
      console.error('Groq API Error (rate lookup):', error);
      return new Map();
    }
  }

  private buildRatePrompt(codes: string[], productName?: string): string {
    const codesList = codes.map(c => `- ${c}`).join('\n');
    
    return `You are a GST expert. I have the following HSN/SAC codes from the official GST database. Please provide the GST rates for each code.

Product: ${productName || 'Not specified'}

HSN/SAC Codes:
${codesList}

For each code, provide:
1. GST rate (0%, 5%, 12%, 18%, or 28%)
2. Confidence level (high, medium, low)
3. Brief reasoning
4. Any warnings or conditions

IMPORTANT:
- These codes are OFFICIAL from GST portal - they are correct
- Only suggest GST rates, don't change the codes
- Consider product context if provided
- Standard GST rates: 0%, 5%, 12%, 18%, 28%

Respond with JSON:
{
  "rates": [
    {
      "code": "21069099",
      "rate": 5,
      "confidence": "high",
      "reasoning": "Food preparations typically at 5% GST",
      "warnings": []
    }
  ]
}`;
  }

  private parseRateResponse(groqResponse: GroqResponse, codes: string[]): Map<string, HSNSuggestion> {
    const rateMap = new Map<string, HSNSuggestion>();
    
    try {
      const content = groqResponse.choices[0]?.message?.content;
      if (!content) {
        return rateMap;
      }

      let jsonContent = content.trim();
      jsonContent = jsonContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      const result = JSON.parse(jsonContent);
      const rates = result.rates || [];
      
      rates.forEach((rateData: any) => {
        const code = rateData.code || '';
        if (codes.includes(code)) {
          rateMap.set(code, {
            code,
            description: '', // Will be filled from database
            rate: rateData.rate || 18,
            confidence: rateData.confidence || 'medium',
            reasoning: rateData.reasoning || '',
            warnings: rateData.warnings || [],
            isService: code.startsWith('99'),
            useCase: ''
          });
        }
      });
    } catch (error) {
      console.error('Error parsing rate response:', error);
    }
    
    return rateMap;
  }

  private buildPrompt(request: HSNValidationRequest): string {
    return `You are a GST expert helping validate HSN/SAC codes for Indian businesses.

Product: "${request.productName}"
${request.category ? `Category: ${request.category}` : ''}
${request.existingHSN ? `Existing HSN: ${request.existingHSN}` : ''}
${request.existingRate ? `Existing Rate: ${request.existingRate}%` : ''}

Provide MULTIPLE valid HSN/SAC code options (2-5 suggestions) for this product, covering different scenarios and use cases.

IMPORTANT GUIDELINES:
1. Provide ALL possible valid codes - don't restrict to one scenario
2. Include different use cases:
   - If it's a service → SAC codes (6 digits, starts with 99)
   - If it's goods → HSN codes (4-8 digits)
   - If it can be both → provide both options
3. Consider different forms/states:
   - Raw material vs finished product
   - Packaged vs unpackaged
   - Service vs goods
   - Different GST rates if applicable
4. Standard GST rates: 0%, 5%, 12%, 18%, 28%
5. For each option, clearly state:
   - When to use it (use case/scenario)
   - Why it applies
   - Any conditions

CRITICAL VALIDATION RULES (format only):
- HSN codes: 4-8 digits (usually 8 digits)
- SAC codes: Exactly 6 digits, starts with 99
- Ensure code format is valid
- Ensure GST rate is standard (0, 5, 12, 18, 28)

Respond with JSON array of suggestions:
{
  "suggestions": [
    {
      "code": "85171200",
      "description": "Telephones for cellular networks",
      "rate": 18,
      "confidence": "high",
      "reasoning": "Mobile phones typically use HSN 8517 series at 18% GST",
      "warnings": [],
      "isService": false,
      "useCase": "Mobile phone device"
    },
    {
      "code": "996331",
      "description": "Restaurant services - freshly prepared food",
      "rate": 5,
      "confidence": "medium",
      "reasoning": "If selling freshly prepared food in restaurant/catering service",
      "warnings": ["Only if providing restaurant service"],
      "isService": true,
      "useCase": "Restaurant/Catering Service"
    }
  ]
}`;
  }

  private async callGroqAPI(prompt: string): Promise<GroqResponse> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a GST expert specializing in HSN/SAC codes for Indian businesses. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3, // Slightly higher for more diverse suggestions
        max_tokens: 1000, // More tokens for multiple suggestions
        response_format: { type: 'json_object' } // Force JSON response
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    return await response.json();
  }

  private parseResponse(groqResponse: GroqResponse, request: HSNValidationRequest): HSNValidationResponse {
    try {
      const content = groqResponse.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from Groq');
      }

      // Try to extract JSON from response
      let jsonContent = content.trim();
      
      // Remove markdown code blocks if present
      jsonContent = jsonContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      const result = JSON.parse(jsonContent);

      // Handle both array format (new) and single object format (backward compat)
      const suggestionsArray = result.suggestions || [result];
      
      // Validate and process each suggestion
      const validatedSuggestions: HSNSuggestion[] = suggestionsArray
        .map((s: any) => {
          const code = s.code || s.hsnCode || '';
          const isService = s.isService || false;
          
          // Validate format only (not product type)
          if (!this.validateHSNSACFormat(code, isService)) {
            return null; // Skip invalid format
          }
          
          // Generate warnings for this suggestion
          const warnings = this.generateWarnings(s, request);
          
          return {
            code,
            description: s.description || '',
            rate: s.gstRate || s.rate || 18,
            confidence: s.confidence || 'medium',
            reasoning: s.reasoning || '',
            warnings,
            isService,
            useCase: s.useCase || s.use_case || ''
          };
        })
        .filter((s: HSNSuggestion | null) => s !== null) as HSNSuggestion[];

      if (validatedSuggestions.length === 0) {
        throw new Error('No valid suggestions found in AI response');
      }

      return {
        suggestions: validatedSuggestions
      };
    } catch (error) {
      console.error('Error parsing Groq response:', error);
      throw new Error('Failed to parse AI response');
    }
  }

  private validateHSNSACFormat(code: string, isService: boolean): boolean {
    if (!code) return false;
    if (isService) {
      // SAC codes: exactly 6 digits, must start with 99
      return /^99\d{4}$/.test(code);
    } else {
      // HSN codes: 4-8 digits
      return /^\d{4,8}$/.test(code);
    }
  }

  private generateWarnings(result: any, request: HSNValidationRequest): string[] {
    const warnings: string[] = [];

    // Add existing warnings from AI if any
    if (result.warnings && Array.isArray(result.warnings)) {
      warnings.push(...result.warnings);
    }

    // Confidence warnings
    if (result.confidence === 'low') {
      warnings.push('⚠️ Low confidence - please verify with your CA or GST consultant');
    }

    // Rate validation
    const standardRates = [0, 5, 12, 18, 28];
    const rate = result.gstRate || result.rate;
    if (rate && !standardRates.includes(rate)) {
      warnings.push('⚠️ Non-standard GST rate - verify with official sources');
    }

    // Mismatch warnings (only for first suggestion or if explicitly comparing)
    const code = result.code || result.hsnCode;
    if (request.existingHSN && request.existingHSN !== code) {
      // Only warn if this is a significant difference, not just different options
      // (Skip this warning for multiple suggestions)
    }

    if (request.existingRate && rate && Math.abs(request.existingRate - rate) > 0.01) {
      // Similar - skip for multiple suggestions context
    }

    // AI disclaimer (only add once, not for every suggestion)
    if (!warnings.some(w => w.includes('AI suggestions are not official'))) {
      warnings.push('ℹ️ AI suggestions are not official - always verify with GST consultant before filing');
    }

    return warnings;
  }
}

