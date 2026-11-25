/**
 * Forge function entry point. `manifest.yml` -> function.resolver -> handler: index.handler
 */
import { resolver } from './resolvers';

export const handler = resolver.getDefinitions();
