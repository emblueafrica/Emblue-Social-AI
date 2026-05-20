import { createHash, randomBytes } from 'node:crypto';
import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { requireBrandAccess, requireBrandRole, resolveRequestBrandId } from '../middleware/auth';
import { sendTeamInviteEmail } from '../utils/email';
import { getRequiredBrandId, sendValidationError } from '../utils/validation';

const router = Router();

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createInviteToken(): string {
  return randomBytes(32).toString('hex');
}

function getInviteUrl(token: string): string {
  const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${frontendUrl}/accept-invite?token=${encodeURIComponent(token)}`;
}

router.post('/invitations', requireBrandRole('client_owner'), requireBrandAccess, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const brandId = resolveRequestBrandId(req);
  if (!brandId) { sendValidationError(res, 'brand_id is required'); return; }

  const body = req.body as Record<string, unknown>;
  const email = cleanString(body.email)?.toLowerCase();
  const fullName = cleanString(body.full_name ?? body.fullName);
  if (!email || !email.includes('@')) { sendValidationError(res, 'email must be valid'); return; }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = createInviteToken();
  const inviteUrl = getInviteUrl(token);

  try {
    const brand = await prisma.brand.findUnique({ where: { brandId }, select: { name: true } });
    if (!brand) { res.status(404).json({ error: 'Brand not found' }); return; }

    const invitation = await prisma.teamInvitation.create({
      data: {
        brandId,
        email,
        fullName,
        role: 'client_member',
        tokenHash: hashToken(token),
        invitedBy: req.user.id,
        expiresAt,
      },
    });

    void sendTeamInviteEmail(email, brand.name, inviteUrl);
    res.status(201).json({
      ok: true,
      invitation_id: Number(invitation.invitationId),
      brand_id: brandId,
      email,
      status: invitation.status,
      expires_at: expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: 'Team invitation failed', message: (err as Error).message });
  }
});

router.get('/invitations/:brand_id', requireBrandRole('client_owner'), requireBrandAccess, async (req: Request, res: Response): Promise<void> => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const rows = await prisma.teamInvitation.findMany({
      where: { brandId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({
      invitations: rows.map(row => ({
        invitation_id: Number(row.invitationId),
        brand_id: row.brandId,
        email: row.email,
        full_name: row.fullName,
        role: row.role,
        status: row.status,
        invited_by: row.invitedBy,
        accepted_by: row.acceptedBy,
        accepted_at: row.acceptedAt,
        expires_at: row.expiresAt,
        created_at: row.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Team invitation lookup failed', message: (err as Error).message });
  }
});

router.post('/invitations/accept', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const token = cleanString((req.body as Record<string, unknown>).token);
  if (!token) { sendValidationError(res, 'token is required'); return; }

  try {
    const invitation = await prisma.teamInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!invitation || invitation.status !== 'pending') {
      res.status(404).json({ error: 'Invitation not found' });
      return;
    }
    if (invitation.expiresAt <= new Date()) {
      await prisma.teamInvitation.update({
        where: { invitationId: invitation.invitationId },
        data: { status: 'expired', updatedAt: new Date() },
      });
      res.status(410).json({ error: 'Invitation expired' });
      return;
    }
    if (invitation.email.toLowerCase() !== req.user.email.toLowerCase()) {
      res.status(403).json({ error: 'Forbidden', message: 'This invitation belongs to another email address' });
      return;
    }

    await prisma.$transaction([
      prisma.brandMembership.upsert({
        where: { brandId_userId: { brandId: invitation.brandId, userId: req.user.id } },
        create: {
          brandId: invitation.brandId,
          userId: req.user.id,
          role: 'client_member',
          isActive: true,
          createdBy: invitation.invitedBy,
        },
        update: {
          role: 'client_member',
          isActive: true,
        },
      }),
      prisma.appUser.update({
        where: { userId: req.user.id },
        data: { status: 'active', fullName: invitation.fullName, updatedAt: new Date() },
      }),
      prisma.teamInvitation.update({
        where: { invitationId: invitation.invitationId },
        data: {
          status: 'accepted',
          acceptedBy: req.user.id,
          acceptedAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    ]);

    res.json({
      ok: true,
      brand_id: invitation.brandId,
      role: 'client_member',
      status: 'accepted',
    });
  } catch (err) {
    res.status(500).json({ error: 'Team invitation acceptance failed', message: (err as Error).message });
  }
});

export default router;
