import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from './config.mjs'
import { isTokenRevoked } from './repository.mjs'

export const createAccessToken = (user) => {
  const jti = randomUUID()
  const token = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      jti,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  )
  return { token, jti }
}

export const verifyAccessToken = (token) => {
  return jwt.verify(token, config.jwtSecret)
}

export const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing bearer token' })
  }

  const token = authHeader.slice('Bearer '.length)
  try {
    const payload = verifyAccessToken(token)
    if (!payload?.sub || !payload?.jti) {
      return res.status(401).json({ message: 'Invalid token payload' })
    }
    const revoked = await isTokenRevoked(payload.jti)
    if (revoked) {
      return res.status(401).json({ message: 'Token is revoked' })
    }
    req.auth = {
      userId: payload.sub,
      email: payload.email,
      jti: payload.jti,
      exp: payload.exp,
      token,
    }
    return next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}
