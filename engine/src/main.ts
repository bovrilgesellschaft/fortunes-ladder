// Entry point for a built page: the build embeds the Venture as JSON before this script.
import { mount } from './ui';
import type { Content } from './types';

declare const FL_CONTENT: Content;
mount(FL_CONTENT);
