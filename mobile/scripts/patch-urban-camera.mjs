// Version/hash guarded, metadata hook; existing callback retains sole ownership of ImageProxy.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const base=path.join(root,"node_modules/react-native-vision-camera");
const pkg=JSON.parse(await readFile(path.join(base,"package.json"),"utf8"));
if(pkg.version!=="5.2.3")throw new Error("Urban camera hook requires VisionCamera 5.2.3");
const file=path.join(base,"android/src/main/java/com/margelo/nitro/camera/hybrids/outputs/HybridFrameOutput.kt");
const bytes=await readFile(file);let source=bytes.toString("utf8");
const marker="// SENSEA bounded optional urban frame observer";
if(source.includes(marker)){console.log("Urban camera hook already applied");process.exit(0);}
if(createHash("sha256").update(bytes).digest("hex")!=="bfc37b8fe6a70e2f167aaec2a556d3ccbaf86153f7739635fbad252349343578")throw new Error("Unexpected VisionCamera frame output source");
const declaration=`
  ${marker}
  private val urbanObserver by lazy {
    try { Class.forName("com.sensea.urban.UrbanFrameAnalyzer").getMethod("offerFrame",
      java.nio.ByteBuffer::class.java, Int::class.javaPrimitiveType, Int::class.javaPrimitiveType,
      Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, Boolean::class.javaPrimitiveType)
    } catch (_: ReflectiveOperationException) { null }
  }
`;
source=source.replace('  private val executor =',declaration+'\n  private val executor =');
source=source.replace('        val frame = HybridFrame(image, orientation, isMirrored)',`        // Observer copies at most one bounded frame synchronously; it never closes/retains image.
        if (image.planes.size == 1 && image.planes[0].pixelStride == 4) {
          try { urbanObserver?.invoke(null, image.planes[0].buffer, image.width, image.height,
            image.planes[0].rowStride, image.imageInfo.rotationDegrees, isMirrored)
          } catch (_: ReflectiveOperationException) { /* Additional analysis must not stop preview. */ }
        }
        val frame = HybridFrame(image, orientation, isMirrored)`);
await writeFile(file,source);console.log("Applied bounded Android urban frame hook");
