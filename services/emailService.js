require("dotenv").config();

const { Resend } = require("resend");

if (!process.env.RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY is missing from environment variables");
}

const resend = new Resend(process.env.RESEND_API_KEY);

const sendPasswordResetEmail = async (email, resetUrl) => {
  const from = "POS Support <onboarding@resend.dev>";

  const { data, error } = await resend.emails.send({
    from,
    to: [email],
    subject: "Reset your POS password",
    text: [
      "We received a request to reset your POS account password.",
      "",
      `Open this link to set a new password:${resetUrl}`,
      "",
      "This link expires in 15 minutes and can only be used once.",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `
       <div style="font-family:Arial,sans-serif;line-height:1.6">
       <h2>Password reset</h2>
       <p>We received a request to reset your POS account password.</p>
        <p>
          <a href="${resetUrl}">Reset your password</a>
        </p>
        <p>This link expires in 15 minutes and can only be used once.</p>
        <p>If you did not request this, you can ignore this email.</P>
       </div>
       `,
  });

  if (error) {
    console.error("Resend email delivery error:", error.message);
    throw new Error("Password reset email could not be sent");
  }

  return data;
};

module.exports = { sendPasswordResetEmail };
