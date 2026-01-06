import { Request, Response, NextFunction } from 'express';
import { getDb } from '../config/database.js';
import { JointAccountMember, JointAccountRole } from '../types/index.js';

// Middleware to verify user is a member of the joint account
export async function requireJointAccountMember(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const jointAccountId = req.params.jointAccountId || req.body.jointAccountId;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'User not authenticated'
    });
  }

  if (!jointAccountId) {
    return res.status(400).json({
      success: false,
      error: 'Bad Request',
      message: 'Joint account ID is required'
    });
  }

  try {
    const db = getDb();
    const membership = await db.collection<JointAccountMember>('jointAccountMembers').findOne({
      jointAccountId,
      userId
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'You are not a member of this joint account'
      });
    }

    // Attach membership info to request
    (req as any).jointAccountMembership = membership;
    next();
  } catch (error) {
    console.error('Joint account membership check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to verify account membership'
    });
  }
}

// Middleware to verify user is admin of the joint account
export async function requireJointAccountAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const jointAccountId = req.params.jointAccountId || req.body.jointAccountId;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'User not authenticated'
    });
  }

  if (!jointAccountId) {
    return res.status(400).json({
      success: false,
      error: 'Bad Request',
      message: 'Joint account ID is required'
    });
  }

  try {
    const db = getDb();
    const membership = await db.collection<JointAccountMember>('jointAccountMembers').findOne({
      jointAccountId,
      userId
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'You are not a member of this joint account'
      });
    }

    if (membership.role !== JointAccountRole.ADMIN) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only admins can perform this action'
      });
    }

    // Attach membership info to request
    (req as any).jointAccountMembership = membership;
    next();
  } catch (error) {
    console.error('Joint account admin check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to verify admin status'
    });
  }
}
