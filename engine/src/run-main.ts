// Entry point for the run page; the build defines FL_WORLD before this script.
import { mountRun } from './run-ui';
import type { World } from './types';

declare const FL_WORLD: World;
mountRun(FL_WORLD);
