"""Exercise the real pinned model on synthetic pixels; this is not an accuracy eval."""
import hashlib
import json
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "assets/models/manifest.json").read_text())
model_path = root / "assets/models" / manifest["file"]
assert hashlib.sha256(model_path.read_bytes()).hexdigest() == manifest["sha256"]
interpreter = Interpreter(model_path=str(model_path), num_threads=1)
interpreter.allocate_tensors()
inputs = interpreter.get_input_details()
assert len(inputs) == 1
assert inputs[0]["dtype"] == np.uint8
assert inputs[0]["shape"].tolist() == [1, 320, 320, 3]
rng = np.random.default_rng(17)
for pixels in (
    np.zeros((1, 320, 320, 3), dtype=np.uint8),
    rng.integers(0, 256, size=(1, 320, 320, 3), dtype=np.uint8),
):
    interpreter.set_tensor(inputs[0]["index"], pixels)
    interpreter.invoke()
    outputs = [interpreter.get_tensor(item["index"]) for item in interpreter.get_output_details()]
    assert len(outputs) == 4
    boxes, classes, scores, count = outputs
    assert all(value.dtype == np.float32 for value in outputs)
    assert boxes.shape == (1, 25, 4)
    assert classes.shape == scores.shape == (1, 25)
    assert count.shape == (1,)
    n = int(count[0])
    assert n == count[0] and 0 <= n <= 25
    assert np.isfinite(boxes).all()
    assert ((scores >= 0) & (scores <= 1)).all()
    assert ((classes[:, :n] >= 0) & (classes[:, :n] < 90)).all()
print("Pinned EfficientDet model: real inference and bounded output contract passed.")
