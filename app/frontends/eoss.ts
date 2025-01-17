/* eslint-disable import/prefer-default-export */
import { initialize } from 'express-openapi';
import * as fs from 'fs';
import * as path from 'path';
import keysToLowerCase from 'util/object';
import { RequestValidationError, NotFoundError } from 'util/errors';
import * as services from 'models/services';
import { Router, Application } from 'express';
import _ from 'lodash';
import DataOperation from 'models/data-operation';
import { CmrUmmVariable } from '../util/cmr';
import { createDecrypter, createEncrypter } from '../util/crypto';
import parseCRS from '../util/crs';
import env from '../util/env';

const version = '0.1.0';
const openApiPath = path.join(__dirname, '..', 'schemas', 'eoss', version, `eoss-v${version}.yml`);
const openApiContent = fs.readFileSync(openApiPath, 'utf-8');

// CMR Granule ID provided as part of the URL
const GRANULE_URL_PATH_REGEX = /\/(?:G\d+-\w+)/g;

/**
 * Sets up the express application with the OpenAPI routes for EOSS
 *
 * @param router - The express router
 */
export function addOpenApiRoutes(app: Router): void {
  initialize({
    app: app as Application,
    apiDoc: openApiPath,
    /* Note: the default way to expose an OpenAPI endpoint is to have express handle paths
     * based on a supplied directory structure. Instead we are using the operations property
     * because we want to include the paths within the OpenAPI specification itself. */
    operations: {
      getLandingPage(req, res): void {
        // HARMONY-72 will implement this functionality - stubbed out for now
        res.append('Content-type', 'text/html');
        res.send('<p>A fine landing page for now.<p>');
      },
      getSpecification(req, res): void {
        res.append('Content-type', 'text/x-yaml');
        res.send(openApiContent);
      },
      getGranule(req, res, next): void {
        req.context.frontend = 'eoss';
        if (!req.collections.every(services.isCollectionSupported)) {
          throw new NotFoundError('There is no service configured to support transformations on the provided collection via EOSS.');
        }
        req.context.logger = req.context.logger.child({ component: 'eoss.getGranule' });
        const query = keysToLowerCase(req.query);

        const encrypter = createEncrypter(env.sharedSecretKey);
        const decrypter = createDecrypter(env.sharedSecretKey);
        const operation = new DataOperation(null, encrypter, decrypter);

        const [crs, srs] = parseCRS({ queryCRS_: query.crs, validate: false });
        operation.crs = crs || query.crs;
        operation.srs = srs;

        if (query.format) {
          operation.outputFormat = query.format;
        }
        if (query.bbox) {
          const [west, south, east, north] = query.bbox;
          operation.boundingRectangle = [west, south, east, north];
        }

        const granuleMatch = req.url.match(GRANULE_URL_PATH_REGEX);
        if (granuleMatch) {
          // Assumes there can only be one granule
          const granuleId = granuleMatch[0].substr(1, granuleMatch[0].length - 1);
          operation.granuleIds = [granuleId];
        }

        // Assuming one collection for now
        const collectionId = req.collections[0].id;
        const variables: CmrUmmVariable[] = [];
        if (query.rangesubset) {
          const variablesRequested = query.rangesubset;
          for (const variableRequested of variablesRequested) {
            const collectionVars = req.collections[0].variables;
            const variable = collectionVars.find((v) => v.umm.Name === variableRequested);
            if (!variable) {
              throw new RequestValidationError(`Invalid rangeSubset parameter: ${variableRequested}`);
            }
            variables.push(variable);
          }
        }
        operation.addSource(collectionId, variables);
        // EOSS is going to be deprecated before supporting async
        operation.requireSynchronous = true;
        req.operation = operation;
        next();
      },
    },
  });

  // Handles returning OpenAPI errors formatted as JSON
  app.use((err, req, res, next) => {
    if (req.path.indexOf('/eoss/') === -1) {
      next(err);
      return;
    }
    if (err.status && err.errors) {
      req.context.logger.error(`Request validation failed with the following errors: ${JSON.stringify(err.errors)}`);
      res.status(err.status).json({
        message: err.message,
        errors: err.errors,
      });
    } else if (err instanceof RequestValidationError) {
      req.context.logger.error(err.message);
      res.status(400).json({
        errors: [err.message],
      });
    } else {
      next(err);
    }
  });
}
