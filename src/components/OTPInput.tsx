'use client'

import { useRef, useState, useEffect, KeyboardEvent, ClipboardEvent } from 'react'

interface OTPInputProps {
  length?: number
  onComplete: (code: string) => void
  disabled?: boolean
  error?: boolean
}

export function OTPInput({ length = 6, onComplete, disabled = false, error = false }: OTPInputProps) {
  const [values, setValues] = useState<string[]>(Array(length).fill(''))
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Focus first input on mount
  useEffect(() => {
    if (!disabled) {
      inputRefs.current[0]?.focus()
    }
  }, [disabled])

  // Check if complete and trigger callback
  useEffect(() => {
    const code = values.join('')
    if (code.length === length && !values.includes('')) {
      onComplete(code)
    }
  }, [values, length, onComplete])

  const handleChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1)

    const newValues = [...values]
    newValues[index] = digit
    setValues(newValues)

    // Auto-advance to next input
    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!values[index] && index > 0) {
        // If current is empty, go back and clear previous
        const newValues = [...values]
        newValues[index - 1] = ''
        setValues(newValues)
        inputRefs.current[index - 1]?.focus()
      } else {
        // Clear current
        const newValues = [...values]
        newValues[index] = ''
        setValues(newValues)
      }
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)

    if (pastedData) {
      const newValues = [...values]
      for (let i = 0; i < pastedData.length; i++) {
        newValues[i] = pastedData[i]
      }
      setValues(newValues)

      // Focus the next empty input or the last one
      const nextEmptyIndex = newValues.findIndex(v => !v)
      if (nextEmptyIndex !== -1) {
        inputRefs.current[nextEmptyIndex]?.focus()
      } else {
        inputRefs.current[length - 1]?.focus()
      }
    }
  }

  const handleFocus = (index: number) => {
    // Select the content when focused
    inputRefs.current[index]?.select()
  }

  return (
    <div className="flex gap-2 sm:gap-3 justify-center">
      {values.map((value, index) => (
        <input
          key={index}
          ref={el => { inputRefs.current[index] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={() => handleFocus(index)}
          disabled={disabled}
          className="w-11 h-14 sm:w-12 sm:h-16 text-center text-2xl font-semibold rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 disabled:opacity-50"
          style={{
            background: 'var(--background)',
            border: error ? '2px solid var(--color-coral)' : '2px solid var(--border)',
            color: 'var(--foreground)',
            // Focus ring color
            '--tw-ring-color': error ? 'var(--color-coral)' : 'var(--accent)',
          } as React.CSSProperties}
          aria-label={`Digit ${index + 1} of ${length}`}
        />
      ))}
    </div>
  )
}
