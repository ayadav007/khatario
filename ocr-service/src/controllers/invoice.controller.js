import { invoiceProcessingService } from '../services/invoiceProcessing.service.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/apiResponse.js';

export const uploadInvoice = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ApiError(400, 'Invoice file is required');
    }

    const result = await invoiceProcessingService.processUploadedInvoice({
      file: req.file,
      metadata: {
        requestId: req.id,
        uploadedBy: req.user?.id || null
      }
    });

    sendSuccess(res, {
      statusCode: 201,
      message: 'Invoice uploaded and processed successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};
