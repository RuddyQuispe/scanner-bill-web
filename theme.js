// ── Gestión de Temas (Light/Dark) ──────────────────────────────────────
const themeToggle = document.getElementById("theme-toggle");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

// Función para aplicar el tema
const setTheme = (isLight) => {
  if (isLight) {
    document.body.classList.add("light-mode");
    localStorage.setItem("theme", "light");
  } else {
    document.body.classList.remove("light-mode");
    localStorage.setItem("theme", "dark");
  }
};

// Inicializar tema: prioridad a localStorage, luego preferencia del sistema
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "light") {
  setTheme(true);
} else if (savedTheme === "dark") {
  setTheme(false);
} else {
  // Por defecto, si no hay nada guardado, usamos la preferencia del sistema
  // PERO el diseño original es oscuro, así que si el sistema prefiere claro lo ponemos claro
  setTheme(!prefersDark.matches);
}

themeToggle.addEventListener("click", () => {
  const isCurrentlyLight = document.body.classList.contains("light-mode");
  console.log("Cambiando tema. ¿Es actualmente claro?:", isCurrentlyLight);
  setTheme(!isCurrentlyLight);
  console.log(
    "Nuevo tema aplicado. ¿Es ahora claro?:",
    document.body.classList.contains("light-mode"),
  );
});

// Escuchar cambios en la preferencia del sistema
prefersDark.addEventListener("change", (e) => {
  if (!localStorage.getItem("theme")) {
    setTheme(!e.matches);
  }
});
