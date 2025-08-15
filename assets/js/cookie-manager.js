/**
 * Forum Cookie Manager
 * Centralized cookie handling for consistent user identification across the forum
 */

// Cookie management functions
function getCookie() {
  const value = "; " + document.cookie
  const parts = value.split("; forum_user_id=")
  if (parts.length === 2) return parts.pop().split(";").shift()
  return null
}

function setCookie(name, value, days) {
  const expires = new Date()
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000)
  document.cookie = name + "=" + value + ";expires=" + expires.toUTCString() + ";path=/"
}

function generateUserCookie() {
  return "user_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now()
}

// Initialize and get user cookie (main function used across the forum)

// Hash function for secure ownership verification
async function generateOwnershipHash(userCookie) {
  const siteSecret = window.siteSecret
  const message = userCookie + siteSecret
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
  return hashHex.substring(0, 16) // Use first 16 chars for shorter hash
}

// Verify ownership using hash comparison
async function verifyOwnership(cookieHash) {
  const userCookie = getOrSetUserCookie()
  const computedHash = await generateOwnershipHash(userCookie)
  return computedHash === cookieHash
}

function getOrSetUserCookie() {
  let userCookie = getCookie()
  if (!userCookie) {
    userCookie = generateUserCookie()
    setCookie("forum_user_id", userCookie, 365) // Set for 1 year
  }
  return userCookie
}
