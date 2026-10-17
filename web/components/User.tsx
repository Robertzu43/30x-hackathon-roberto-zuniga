// R-131: a sentence from the UI dictionary with user data inside it. `t(key)` leaves `{name}` unfilled, so the copy stays outside
// the marker and only the data gets `data-user` (AC-91 item 5 Clarified). `copy` fills the placeholders that are copy or app-formatted.
import { Fragment, type ReactNode } from 'react';

export const tu = (s: string, user: Record<string, string>): ReactNode =>
  s.split(/\{(\w+)\}/).map((p, i) => (i % 2 ? <span key={i} data-user="">{user[p]}</span> : <Fragment key={i}>{p}</Fragment>));

// A field value the app prints as it came (a name, a number, a text) is data; one it formats itself (money(), a long date) is not.
export const printedAsRead = (name: string, v: string | number): boolean => typeof v !== 'number' && !name.endsWith('_date');
