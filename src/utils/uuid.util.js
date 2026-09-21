const crypto = require('crypto');

class UuidUtils {
  /**
   * Generate a RFC 4122 UUID v4.
   *
   * @returns {string} UUID
   */
  static generate() {
    return crypto.randomUUID();
  }
}

module.exports = UuidUtils;
