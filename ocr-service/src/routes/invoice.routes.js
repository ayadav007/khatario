import { Router } from 'express';
import { uploadInvoice } from '../controllers/invoice.controller.js';
import { uploadSingleInvoice } from '../middleware/upload.js';

const router = Router();

router.post('/upload', uploadSingleInvoice, uploadInvoice);

export default router;
