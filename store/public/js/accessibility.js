/* Accessibility toggles — same behavior as the consulting site's controls.
   Plain script, no imports, no third-party code. */
(function () {
    "use strict";

    var THEME_STORAGE_KEY = "theme-mode";
    var COLORBLIND_STORAGE_KEY = "colorblind-mode";

    function applySavedState() {
        var savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        var savedColorblind = localStorage.getItem(COLORBLIND_STORAGE_KEY);
        var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        var prefersContrast = window.matchMedia("(prefers-contrast: more)").matches ||
            window.matchMedia("(prefers-contrast: high)").matches;

        if (savedTheme === "dark" || (!savedTheme && (prefersDark || prefersContrast))) {
            document.body.classList.add("dark-mode");
        } else {
            document.body.classList.remove("dark-mode");
        }

        if (savedColorblind === "on") {
            document.body.classList.add("colorblind-mode");
        } else {
            document.body.classList.remove("colorblind-mode");
        }
    }

    function initControls() {
        var themeToggle = document.querySelector(".theme-toggle");
        var colorblindToggle = document.querySelector(".colorblind-toggle");
        var resetButton = document.querySelector(".reset-accessibility");

        function applyThemeState() {
            var isDark = document.body.classList.contains("dark-mode");
            if (themeToggle) {
                themeToggle.textContent = "Dark mode: " + (isDark ? "On" : "Off");
                themeToggle.setAttribute("aria-pressed", String(isDark));
            }
        }

        function applyColorblindState() {
            var isColorblind = document.body.classList.contains("colorblind-mode");
            if (colorblindToggle) {
                colorblindToggle.textContent = "Colorblind mode: " + (isColorblind ? "On" : "Off");
                colorblindToggle.setAttribute("aria-pressed", String(isColorblind));
            }
        }

        applyThemeState();
        applyColorblindState();

        if (themeToggle) {
            themeToggle.addEventListener("click", function () {
                document.body.classList.toggle("dark-mode");
                var isDark = document.body.classList.contains("dark-mode");
                localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");
                applyThemeState();
            });
        }

        if (colorblindToggle) {
            colorblindToggle.addEventListener("click", function () {
                document.body.classList.toggle("colorblind-mode");
                var isColorblind = document.body.classList.contains("colorblind-mode");
                localStorage.setItem(COLORBLIND_STORAGE_KEY, isColorblind ? "on" : "off");
                applyColorblindState();
            });
        }

        if (resetButton) {
            resetButton.addEventListener("click", function () {
                document.body.classList.remove("dark-mode", "colorblind-mode");
                localStorage.removeItem(THEME_STORAGE_KEY);
                localStorage.removeItem(COLORBLIND_STORAGE_KEY);
                applyThemeState();
                applyColorblindState();
            });
        }
    }

    applySavedState();
    document.addEventListener("DOMContentLoaded", initControls);
})();
