import { Router, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import openApiSpec from '../docs/openapi';

const router = Router();

export function docsJson(_req: Request, res: Response): void {
  res.json(openApiSpec);
}

router.get('/json', docsJson);

router.use('/', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  explorer: true,
  customSiteTitle: 'Social Emblue AI API Docs',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
  },
}));

export default router;
