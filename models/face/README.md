# Face models for Khatario Staff check-in

Run `npm run face:models` to download them here; it checks each file's sha256 from `manifest.json`.
The `.onnx` files are not kept in git.

| File | Model | License | Use |
| --- | --- | --- | --- |
| `face_detection_yunet_2023mar.onnx` | YuNet, OpenCV Zoo | MIT | finds the face and five landmarks |
| `face_recognition_sface_2021dec.onnx` | SFace, OpenCV Zoo | Apache-2.0 | 128-number face template |

Both licenses allow commercial use. Do not swap in InsightFace pretrained weights (buffalo_l,
antelopev2, ArcFace packs): their license is non-commercial research only.

Matching runs on our own server with `onnxruntime-node` (MIT); no photo or template is sent to any
other service. Set `FACE_MODEL_DIR` to read the files from somewhere else.
