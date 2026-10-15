const workspaces = document.querySelectorAll(".workspace");

workspaces.forEach((workspace, index) => {
  workspace.style.opacity = "0";
  workspace.style.transform = "translateY(14px)";

  window.setTimeout(() => {
    workspace.style.transition =
      "opacity 420ms ease, transform 420ms ease, border-color 180ms ease, background-color 180ms ease";
    workspace.style.opacity = "1";
    workspace.style.transform = "translateY(0)";
  }, 140 + index * 90);
});
