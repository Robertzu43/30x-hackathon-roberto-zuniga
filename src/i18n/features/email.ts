// Email intake's reply to the vendor (AC-87, R-91): fixed templates around intake's recorded reply lines; no model text.
export const es: Record<string, string> = {
  'email_in.subject': 'Recibí tu factura para {company}',
  'email_in.invoice': 'Factura {n}',
  'email_in.ignored': 'No leí estos adjuntos (leo hasta 3 PDF, PNG o JPG de hasta 10 MB por correo): {files}',
};

export const en: Record<string, string> = {
  'email_in.subject': 'I received your invoice for {company}',
  'email_in.invoice': 'Invoice {n}',
  'email_in.ignored': "I didn't read these attachments (I read up to 3 PDF, PNG or JPG files of up to 10 MB per email): {files}",
};
