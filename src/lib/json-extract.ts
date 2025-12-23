/**
 * Robust JSON extraction from AI responses
 * Handles various formatting patterns LLMs may use
 */

/**
 * Extract JSON from a string that may contain markdown code blocks or other formatting
 * Tries multiple extraction strategies in order of preference
 */
export function extractJSON<T = unknown>(content: string): T | null {
  if (!content || typeof content !== 'string') {
    return null
  }

  const trimmed = content.trim()

  // Strategy 1: Direct parse (content is already valid JSON)
  const directParse = tryParse<T>(trimmed)
  if (directParse !== null) {
    return directParse
  }

  // Strategy 2: Extract from markdown code blocks (```json ... ``` or ``` ... ```)
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    const extracted = codeBlockMatch[1].trim()
    const parsed = tryParse<T>(extracted)
    if (parsed !== null) {
      return parsed
    }
  }

  // Strategy 3: Find first { and last } (for objects)
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const extracted = trimmed.substring(firstBrace, lastBrace + 1)
    const parsed = tryParse<T>(extracted)
    if (parsed !== null) {
      return parsed
    }
  }

  // Strategy 4: Find first [ and last ] (for arrays)
  const firstBracket = trimmed.indexOf('[')
  const lastBracket = trimmed.lastIndexOf(']')
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const extracted = trimmed.substring(firstBracket, lastBracket + 1)
    const parsed = tryParse<T>(extracted)
    if (parsed !== null) {
      return parsed
    }
  }

  // Strategy 5: Look for JSON after common prefixes
  const prefixPatterns = [
    /(?:here(?:'s| is)(?: the)? (?:the )?(?:json|response|output|data)[:\s]*)/i,
    /(?:json[:\s]*)/i,
    /(?:response[:\s]*)/i,
  ]

  for (const pattern of prefixPatterns) {
    const match = trimmed.match(pattern)
    if (match && match.index !== undefined) {
      const afterPrefix = trimmed.substring(match.index + match[0].length).trim()
      const parsed = extractJSON<T>(afterPrefix)
      if (parsed !== null) {
        return parsed
      }
    }
  }

  return null
}

/**
 * Try to parse JSON, return null on failure
 */
function tryParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T
  } catch {
    return null
  }
}
