// app/helpers/auth.js

function isAuthenticated() {
  return !!global.authToken;
}

function getCurrentUserId() {
  try {
    if (!global.authToken) return null;
    const payload = JSON.parse(
      Buffer.from(global.authToken.split('.')[1], 'base64').toString()
    );
    return payload.userId;
  } catch (err) {
    console.error('Invalid token:', err.message);
    return null;
  }
}

module.exports = { isAuthenticated, getCurrentUserId };
