/**
 * User submissions have no price or flyer field. Those keys are always null
 * in the publish payload. Sending them on an update clears a price or image
 * that was added on the published event afterwards.
 */
export function withoutUncollectedEventFields<T extends object>(
  payload: T,
): Omit<T, "price" | "image_url"> {
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "price" || key === "image_url") continue;
    update[key] = value;
  }
  return update as Omit<T, "price" | "image_url">;
}
