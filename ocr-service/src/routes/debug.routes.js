import { Router } from 'express';
import { llmHealth } from '../controllers/debug.controller.js';

const router = Router();

router.get('/llm-health', llmHealth);

export default router;
