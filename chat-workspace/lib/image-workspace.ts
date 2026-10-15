export const IMAGE_WORKSPACE_TOOL_NAME = "open_image_workspace";
export const IMAGE_WORKSPACE_ORIGIN = "https://sub2image.cc.cd";

export const getImageWorkspaceOrigin = () => {
  const configuredOrigin = process.env.NEXT_PUBLIC_IMAGE_WORKSPACE_URL?.trim();
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");

  if (
    typeof window !== "undefined" &&
    ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ) {
    return `${window.location.protocol}//${window.location.hostname}:4173`;
  }

  return IMAGE_WORKSPACE_ORIGIN;
};

export const buildImageWorkspaceUrl = (prompt: string, origin = getImageWorkspaceOrigin()) => {
  const url = new URL(origin);
  url.searchParams.set("prompt", prompt);
  return url.toString();
};
