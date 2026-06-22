const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'PinkCurve <onboarding@resend.dev>';

async function sendAdApprovedEmail(sellerEmail, sellerName, adTitle) {
    try {
        await resend.emails.send({
            from: FROM,
            to: sellerEmail,
            subject: `Your ad "${adTitle}" is live on PinkCurve! 🎉`,
            html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #ec4899;">Great news, ${sellerName}!</h2>
          <p>Your ad <strong>"${adTitle}"</strong> has been approved and is now live on PinkCurve.</p>
          <p>Buyers can now discover your product through our intent-matching engine.</p>
          <a href="https://ad-engine-4da45.web.app" style="display:inline-block;margin-top:16px;padding:10px 20px;background:linear-gradient(135deg,#ec4899,#a855f7);color:white;text-decoration:none;border-radius:6px;">View Dashboard</a>
        </div>
      `,
        });
        console.log(`Approval email sent to ${sellerEmail}`);
    } catch (err) {
        console.error('Failed to send approval email:', err);
    }
}

async function sendMatchNotificationEmail(sellerEmail, sellerName, adTitle, matchType) {
    try {
        await resend.emails.send({
            from: FROM,
            to: sellerEmail,
            subject: `New activity on "${adTitle}" 👀`,
            html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #ec4899;">Hi ${sellerName},</h2>
          <p>Your ad <strong>"${adTitle}"</strong> just got a new ${matchType === 'click' ? 'click' : 'match'} from a buyer on PinkCurve.</p>
          <a href="https://ad-engine-4da45.web.app" style="display:inline-block;margin-top:16px;padding:10px 20px;background:linear-gradient(135deg,#ec4899,#a855f7);color:white;text-decoration:none;border-radius:6px;">View Analytics</a>
        </div>
      `,
        });
        console.log(`Match notification sent to ${sellerEmail}`);
    } catch (err) {
        console.error('Failed to send match email:', err);
    }
}

module.exports = { sendAdApprovedEmail, sendMatchNotificationEmail };