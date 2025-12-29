# Supabase Email Templates for Familjen

These are branded email templates to paste into your Supabase dashboard:
**Authentication → Email Templates**

## Brand Colors
- Primary (coral): #E8786D
- Secondary (teal): #7EB6C4
- Accent (sage): #8BA888
- Background: #F8F4F0
- Text: #2D2D2D
- Muted: #7A7A7A

## Logo URL
The templates reference: `https://familjen.eu/icons/icon-128x128.png`

If your domain is different, replace `familjen.eu` with your actual domain.

---

## 1. Magic Link

**Subject:** Your login code for Familjen

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #F8F4F0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F8F4F0; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; background: linear-gradient(135deg, #E8786D 0%, #D4635A 100%);">
              <img src="https://familjen.eu/icons/icon-128x128.png" alt="Familjen" width="64" height="64" style="display: block; margin: 0 auto 16px; border-radius: 14px;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #FFFFFF;">Familjen</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #2D2D2D; text-align: center;">Your login code</h2>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #7A7A7A; text-align: center;">
                Use this one-time code to log in:
              </p>

              <!-- OTP Code -->
              <div style="background-color: #F8F4F0; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #E8786D; font-family: 'Courier New', monospace;">{{ .Token }}</span>
              </div>

              <p style="margin: 0 0 24px; font-size: 14px; color: #7A7A7A; text-align: center;">
                Or click the button below:
              </p>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 14px 32px; background-color: #E8786D; color: #FFFFFF; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 12px;">
                      Log in
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; font-size: 13px; color: #7A7A7A; text-align: center;">
                This code expires in 1 hour.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #F8F4F0; border-top: 1px solid #E5E5E5;">
              <p style="margin: 0; font-size: 13px; color: #7A7A7A; text-align: center;">
                If you didn't request this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>

        <!-- Bottom text -->
        <p style="margin: 24px 0 0; font-size: 12px; color: #7A7A7A; text-align: center;">
          Familjen - Your family's digital hub
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 2. Confirm Sign Up

**Subject:** Confirm your email address - Familjen

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #F8F4F0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F8F4F0; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; background: linear-gradient(135deg, #E8786D 0%, #D4635A 100%);">
              <img src="https://familjen.eu/icons/icon-128x128.png" alt="Familjen" width="64" height="64" style="display: block; margin: 0 auto 16px; border-radius: 14px;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #FFFFFF;">Familjen</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #2D2D2D; text-align: center;">Welcome to Familjen!</h2>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #7A7A7A; text-align: center;">
                Please confirm your email address to complete registration.
              </p>

              <!-- OTP Code -->
              <div style="background-color: #F8F4F0; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; font-size: 13px; color: #7A7A7A;">Your confirmation code:</p>
                <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #E8786D; font-family: 'Courier New', monospace;">{{ .Token }}</span>
              </div>

              <p style="margin: 0 0 24px; font-size: 14px; color: #7A7A7A; text-align: center;">
                Or click the button below:
              </p>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 14px 32px; background-color: #E8786D; color: #FFFFFF; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 12px;">
                      Confirm email address
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #F8F4F0; border-top: 1px solid #E5E5E5;">
              <p style="margin: 0; font-size: 13px; color: #7A7A7A; text-align: center;">
                If you didn't create this account, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>

        <p style="margin: 24px 0 0; font-size: 12px; color: #7A7A7A; text-align: center;">
          Familjen - Your family's digital hub
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 3. Invite User

**Subject:** You're invited to Familjen

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #F8F4F0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F8F4F0; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; background: linear-gradient(135deg, #E8786D 0%, #D4635A 100%);">
              <img src="https://familjen.eu/icons/icon-128x128.png" alt="Familjen" width="64" height="64" style="display: block; margin: 0 auto 16px; border-radius: 14px;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #FFFFFF;">Familjen</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #2D2D2D; text-align: center;">You're invited!</h2>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #7A7A7A; text-align: center;">
                You've been invited to join a household on Familjen - the app that helps families organize everyday life.
              </p>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 14px 32px; background-color: #E8786D; color: #FFFFFF; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 12px;">
                      Accept invitation
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; font-size: 13px; color: #7A7A7A; text-align: center;">
                This link expires in 24 hours.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #F8F4F0; border-top: 1px solid #E5E5E5;">
              <p style="margin: 0; font-size: 13px; color: #7A7A7A; text-align: center;">
                If you weren't expecting this invitation, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>

        <p style="margin: 24px 0 0; font-size: 12px; color: #7A7A7A; text-align: center;">
          Familjen - Your family's digital hub
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 4. Change Email Address

**Subject:** Confirm your new email address - Familjen

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #F8F4F0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F8F4F0; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; background: linear-gradient(135deg, #E8786D 0%, #D4635A 100%);">
              <img src="https://familjen.eu/icons/icon-128x128.png" alt="Familjen" width="64" height="64" style="display: block; margin: 0 auto 16px; border-radius: 14px;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #FFFFFF;">Familjen</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #2D2D2D; text-align: center;">Confirm email change</h2>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #7A7A7A; text-align: center;">
                We received a request to change your account's email address. Click the button below to confirm.
              </p>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 14px 32px; background-color: #E8786D; color: #FFFFFF; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 12px;">
                      Confirm new email
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; font-size: 13px; color: #7A7A7A; text-align: center;">
                This link expires in 1 hour.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #F8F4F0; border-top: 1px solid #E5E5E5;">
              <p style="margin: 0; font-size: 13px; color: #7A7A7A; text-align: center;">
                If you didn't request this change, please contact support immediately.
              </p>
            </td>
          </tr>
        </table>

        <p style="margin: 24px 0 0; font-size: 12px; color: #7A7A7A; text-align: center;">
          Familjen - Your family's digital hub
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 5. Reset Password

**Subject:** Reset your password - Familjen

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #F8F4F0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F8F4F0; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; background: linear-gradient(135deg, #E8786D 0%, #D4635A 100%);">
              <img src="https://familjen.eu/icons/icon-128x128.png" alt="Familjen" width="64" height="64" style="display: block; margin: 0 auto 16px; border-radius: 14px;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #FFFFFF;">Familjen</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #2D2D2D; text-align: center;">Reset your password</h2>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #7A7A7A; text-align: center;">
                We received a request to reset your password. Click the button below to choose a new password.
              </p>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 14px 32px; background-color: #E8786D; color: #FFFFFF; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 12px;">
                      Reset password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; font-size: 13px; color: #7A7A7A; text-align: center;">
                This link expires in 1 hour.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #F8F4F0; border-top: 1px solid #E5E5E5;">
              <p style="margin: 0; font-size: 13px; color: #7A7A7A; text-align: center;">
                If you didn't request this reset, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>

        <p style="margin: 24px 0 0; font-size: 12px; color: #7A7A7A; text-align: center;">
          Familjen - Your family's digital hub
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 6. Reauthentication

**Subject:** Confirm your identity - Familjen

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #F8F4F0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F8F4F0; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; background: linear-gradient(135deg, #E8786D 0%, #D4635A 100%);">
              <img src="https://familjen.eu/icons/icon-128x128.png" alt="Familjen" width="64" height="64" style="display: block; margin: 0 auto 16px; border-radius: 14px;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #FFFFFF;">Familjen</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #2D2D2D; text-align: center;">Confirm your identity</h2>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #7A7A7A; text-align: center;">
                To complete this action, we need to verify it's you.
              </p>

              <!-- OTP Code -->
              <div style="background-color: #F8F4F0; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; font-size: 13px; color: #7A7A7A;">Your verification code:</p>
                <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #E8786D; font-family: 'Courier New', monospace;">{{ .Token }}</span>
              </div>

              <p style="margin: 0 0 24px; font-size: 14px; color: #7A7A7A; text-align: center;">
                Or click the button below:
              </p>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 14px 32px; background-color: #E8786D; color: #FFFFFF; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 12px;">
                      Confirm
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; font-size: 13px; color: #7A7A7A; text-align: center;">
                This code expires in 10 minutes.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #F8F4F0; border-top: 1px solid #E5E5E5;">
              <p style="margin: 0; font-size: 13px; color: #7A7A7A; text-align: center;">
                If you didn't initiate this action, please change your password immediately.
              </p>
            </td>
          </tr>
        </table>

        <p style="margin: 24px 0 0; font-size: 12px; color: #7A7A7A; text-align: center;">
          Familjen - Your family's digital hub
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## How to Apply These Templates

1. Go to your Supabase Dashboard
2. Navigate to **Authentication** → **Email Templates**
3. Click on each template type
4. Replace the **Subject** line
5. Paste the HTML into the **Body** section
6. Click **Save**

### Available Supabase Variables

These variables are automatically replaced by Supabase:
- `{{ .Token }}` - The 6-digit OTP code
- `{{ .ConfirmationURL }}` - The magic link URL
- `{{ .SiteURL }}` - Your site's base URL

### Logo URL

The templates use: `https://familjen.eu/icons/icon-128x128.png`

If your domain is different, do a find-and-replace to update the URL in all templates.
