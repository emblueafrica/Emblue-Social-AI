import { Request, Response, NextFunction } from 'express';
import { resolveRequestBrandId } from './auth';
import { getMissingToolIds } from '../tools/access';
import { ToolId, TOOL_REGISTRY } from '../tools/registry';

export function requireToolAccess(toolId: ToolId) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const brandId = resolveRequestBrandId(req);
    if (!brandId) {
      res.status(403).json({
        error: 'Brand access required',
        message: 'This account is not attached to an approved brand workspace.',
      });
      return;
    }

    if (req.user?.platform_role === 'super_admin' || req.user?.platform_role === 'platform_admin') {
      next();
      return;
    }

    try {
      const missingToolIds = await getMissingToolIds(brandId, toolId);
      if (missingToolIds.length) {
        res.status(403).json({
          error: 'Tool not enabled',
          message: `Your current plan does not include ${TOOL_REGISTRY[toolId].name}.`,
          tool_id: toolId,
          missing_tool_ids: missingToolIds,
          upgrade_url: '/settings/upgrade',
        });
        return;
      }

      next();
    } catch (err) {
      res.status(500).json({ error: 'Tool access check failed', message: (err as Error).message });
    }
  };
}
