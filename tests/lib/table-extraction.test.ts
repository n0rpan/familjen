import { describe, it, expect } from 'vitest'

/**
 * Test helper: Extract the table-to-markdown conversion logic
 * This mirrors the logic in document-extraction.ts
 */
function convertTablesToMarkdown(html: string): string {
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi

  return html.replace(tableRegex, (_, tableContent: string) => {
    const rows: string[][] = []

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rowMatch: RegExpExecArray | null

    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const rowContent = rowMatch[1]
      const cells: string[] = []

      const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi
      let cellMatch: RegExpExecArray | null

      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        let cellText = cellMatch[1]
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim()

        if (cellText.length > 200) {
          cellText = cellText.slice(0, 200) + '...'
        }

        cells.push(cellText)
      }

      if (cells.length > 0) {
        rows.push(cells)
      }
    }

    if (rows.length === 0) {
      return ''
    }

    const markdown: string[] = []

    if (rows.length > 0) {
      markdown.push('| ' + rows[0].join(' | ') + ' |')
      markdown.push('| ' + rows[0].map(() => '---').join(' | ') + ' |')
    }

    for (let i = 1; i < rows.length; i++) {
      markdown.push('| ' + rows[i].join(' | ') + ' |')
    }

    return '\n\n' + markdown.join('\n') + '\n\n'
  })
}

describe('Table to Markdown Conversion', () => {
  it('converts a simple table to markdown format', () => {
    const html = `
      <table>
        <tr><th>Header 1</th><th>Header 2</th></tr>
        <tr><td>Cell 1</td><td>Cell 2</td></tr>
        <tr><td>Cell 3</td><td>Cell 4</td></tr>
      </table>
    `
    const result = convertTablesToMarkdown(html)

    expect(result).toContain('| Header 1 | Header 2 |')
    expect(result).toContain('| --- | --- |')
    expect(result).toContain('| Cell 1 | Cell 2 |')
    expect(result).toContain('| Cell 3 | Cell 4 |')
  })

  it('handles school calendar table structure', () => {
    const html = `
      <table>
        <tr>
          <th>MÅNED</th>
          <th>ANTALL SKOLEDAGER</th>
          <th>ELEVENES FERIER</th>
          <th>SFO</th>
        </tr>
        <tr>
          <td>AUGUST</td>
          <td>10</td>
          <td>Skolestart 14. august<br>Elevene slutter kl. 11.00</td>
          <td>Åpent fra 4. aug</td>
        </tr>
        <tr>
          <td>OKTOBER</td>
          <td>20</td>
          <td>Høstferie uke 40</td>
          <td>Åpent i høstferien</td>
        </tr>
      </table>
    `
    const result = convertTablesToMarkdown(html)

    // Check header row is preserved
    expect(result).toContain('| MÅNED | ANTALL SKOLEDAGER | ELEVENES FERIER | SFO |')

    // Check separator row
    expect(result).toContain('| --- | --- | --- | --- |')

    // Check data rows preserve content
    expect(result).toContain('AUGUST')
    expect(result).toContain('Skolestart 14. august')
    expect(result).toContain('Høstferie uke 40')
  })

  it('handles nested HTML within table cells', () => {
    const html = `
      <table>
        <tr><th>Event</th><th>Date</th></tr>
        <tr>
          <td><strong>Foreldremøte</strong></td>
          <td><span>15. september</span></td>
        </tr>
      </table>
    `
    const result = convertTablesToMarkdown(html)

    expect(result).toContain('Foreldremøte')
    expect(result).toContain('15. september')
  })

  it('handles empty tables', () => {
    const html = '<table></table>'
    const result = convertTablesToMarkdown(html)

    // Empty table should be removed
    expect(result).toBe('')
  })

  it('handles multiple tables in HTML', () => {
    const html = `
      <table>
        <tr><th>Table 1</th></tr>
        <tr><td>Data 1</td></tr>
      </table>
      <p>Some text between tables</p>
      <table>
        <tr><th>Table 2</th></tr>
        <tr><td>Data 2</td></tr>
      </table>
    `
    const result = convertTablesToMarkdown(html)

    expect(result).toContain('| Table 1 |')
    expect(result).toContain('| Data 1 |')
    expect(result).toContain('| Table 2 |')
    expect(result).toContain('| Data 2 |')
    expect(result).toContain('Some text between tables')
  })

  it('truncates very long cell content', () => {
    const longContent = 'A'.repeat(300)
    const html = `
      <table>
        <tr><th>Column</th></tr>
        <tr><td>${longContent}</td></tr>
      </table>
    `
    const result = convertTablesToMarkdown(html)

    // Content should be truncated to 200 chars + '...'
    expect(result).toContain('A'.repeat(200) + '...')
    expect(result).not.toContain('A'.repeat(250))
  })

  it('handles &nbsp; and other HTML entities', () => {
    const html = `
      <table>
        <tr><th>Name</th></tr>
        <tr><td>Hello&nbsp;&amp;&nbsp;World</td></tr>
      </table>
    `
    const result = convertTablesToMarkdown(html)

    expect(result).toContain('Hello & World')
  })

  it('converts br tags to spaces in cells', () => {
    const html = `
      <table>
        <tr><th>Info</th></tr>
        <tr><td>Line 1<br>Line 2<br/>Line 3</td></tr>
      </table>
    `
    const result = convertTablesToMarkdown(html)

    expect(result).toContain('Line 1 Line 2 Line 3')
  })

  it('handles rowspan/colspan by extracting cell content (limitation: spans not preserved)', () => {
    // Note: The current regex-based approach extracts cell content but doesn't
    // preserve rowspan/colspan semantics. This is acceptable because:
    // 1. School calendars rarely use complex spans
    // 2. The AI model can infer relationships from context
    // 3. A full HTML parser would add significant complexity
    const html = `
      <table>
        <tr>
          <th rowspan="2">Month</th>
          <th colspan="2">Events</th>
        </tr>
        <tr>
          <th>School</th>
          <th>SFO</th>
        </tr>
        <tr>
          <td>August</td>
          <td>Skolestart 18. aug</td>
          <td>Åpent fra 4. aug</td>
        </tr>
      </table>
    `
    const result = convertTablesToMarkdown(html)

    // All content is extracted, though layout may differ from visual
    expect(result).toContain('Month')
    expect(result).toContain('Events')
    expect(result).toContain('School')
    expect(result).toContain('SFO')
    expect(result).toContain('August')
    expect(result).toContain('Skolestart 18. aug')
    expect(result).toContain('Åpent fra 4. aug')
  })

  it('handles tables with thead and tbody wrappers', () => {
    const html = `
      <table>
        <thead>
          <tr><th>Header 1</th><th>Header 2</th></tr>
        </thead>
        <tbody>
          <tr><td>Data 1</td><td>Data 2</td></tr>
        </tbody>
      </table>
    `
    const result = convertTablesToMarkdown(html)

    expect(result).toContain('| Header 1 | Header 2 |')
    expect(result).toContain('| Data 1 | Data 2 |')
  })
})
