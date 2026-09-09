// The public service treats these sequences as template replacements, so it
// cannot preserve their literal content. Keep preview and write checks aligned.
export function publicContentWarnings(html: string): string[] {
  return /\$[&`']|TEMPLATE_[A-Z_]+/.test(html)
    ? ['Public content contains unsupported server-template replacement sequences ($&, $`, $\' or TEMPLATE_*); remove them before publishing.']
    : []
}
