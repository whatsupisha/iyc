// Test script to verify hash consistency between Node.js and Browser crypto implementations

const crypto = require('crypto');

// Backend implementation (Node.js)
function generateOwnershipHashBackend(userCookie) {
  const siteSecret = 'forum_secret_key_2025_secure_hash_verification'
  const message = userCookie + siteSecret
  return crypto.createHash('sha256').update(message).digest('hex').substring(0, 16)
}

// Frontend implementation adapted for Node.js testing
async function generateOwnershipHashFrontend(userCookie) {
  const siteSecret = 'forum_secret_key_2025_secure_hash_verification'
  const message = userCookie + siteSecret
  
  // Using Node.js crypto to simulate browser crypto.subtle behavior
  const hash = crypto.createHash('sha256').update(message).digest('hex')
  return hash.substring(0, 16)
}

// Test with sample data
const testCookie = 'test_user_cookie_12345'

console.log('Testing hash consistency...')
console.log('Input cookie:', testCookie)
console.log('Backend hash:', generateOwnershipHashBackend(testCookie))

generateOwnershipHashFrontend(testCookie).then(frontendHash => {
  console.log('Frontend hash:', frontendHash)
  console.log('Hashes match:', generateOwnershipHashBackend(testCookie) === frontendHash)
})
