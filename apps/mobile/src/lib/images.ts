import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";

/** Downscale and re-encode before upload (faster on cellular; the server also strips metadata). */
export async function compressForUpload(uri: string, maxEdge = 1600): Promise<string> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    ctx.resize({ width: maxEdge });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress: 0.75, format: SaveFormat.JPEG });
    return out.uri;
  } catch {
    return uri;
  }
}

export async function appendImage(form: FormData, field: string, uri: string): Promise<void> {
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append(field, blob, `${field}.jpg`);
  } else {
    // React Native FormData accepts { uri, name, type } file descriptors.
    form.append(field, { uri, name: `${field}.jpg`, type: "image/jpeg" } as unknown as Blob);
  }
}
