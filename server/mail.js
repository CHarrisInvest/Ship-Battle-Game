/**
 * The sign-in code, sent by Resend's HTTP API. One request, no library: the message is a line of
 * plain text and the same line as HTML, so it reads in any mail client and says nothing it need not.
 */

/** A `sendCode(email, code)` that sends through Resend with `apiKey`, from `from`. */
export function resendSender({ apiKey, from, fetchImpl = fetch }) {
  return async (email, code) => {
    const text = `Your Sternchase sign-in code is ${code}. It works for 10 minutes. If you did not ask for it, you can ignore this email.`;
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `${code} is your Sternchase sign-in code`,
        text,
        html: `<p style="font-family:Georgia,serif;font-size:16px">Your Sternchase sign-in code is</p>`
          + `<p style="font-family:Georgia,serif;font-size:32px;letter-spacing:6px;margin:8px 0"><b>${code}</b></p>`
          + `<p style="font-family:Georgia,serif;font-size:14px;color:#555">It works for 10 minutes. If you did not ask for it, you can ignore this email.</p>`,
      }),
    });
    // the address is never logged, only that a send failed and why Resend says it did
    if (!res.ok) throw new Error(`Resend refused the code: ${res.status} ${await res.text().catch(() => "")}`);
  };
}
