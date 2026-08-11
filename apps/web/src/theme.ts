import { alpha, createTheme, type PaletteMode } from "@mui/material/styles";

export type ThemeColor = "sky" | "teal" | "indigo" | "amber" | "rose";

interface ThemeModeTokens {
  primary: { main: string; dark: string; contrastText: string };
  background: { default: string; paper: string };
  text: { primary: string; secondary: string };
  divider: string;
  tableHead: string;
  scrollbar: string;
  scrollbarHover: string;
}

interface ThemeColorOption {
  value: ThemeColor;
  label: string;
  swatch: string;
  light: ThemeModeTokens;
  dark: ThemeModeTokens;
}

export const THEME_COLOR_OPTIONS: readonly ThemeColorOption[] = [
  {
    value: "sky",
    label: "浅蓝",
    swatch: "#4b96d1",
    light: {
      primary: { main: "#3f8fcb", dark: "#2d6eaa", contrastText: "#ffffff" },
      background: { default: "#f3f7fb", paper: "#ffffff" },
      text: { primary: "#172433", secondary: "#5c6b7a" },
      divider: "#d8e3ed",
      tableHead: "#f7fafe",
      scrollbar: "#9badbd",
      scrollbarHover: "#667b8d",
    },
    dark: {
      primary: { main: "#86c5f4", dark: "#5aa8df", contrastText: "#10202d" },
      background: { default: "#101820", paper: "#18222c" },
      text: { primary: "#edf4fa", secondary: "#a7b7c6" },
      divider: "#30404f",
      tableHead: "#1d2934",
      scrollbar: "#5a6f80",
      scrollbarHover: "#8397a7",
    },
  },
  {
    value: "teal",
    label: "青绿",
    swatch: "#147d64",
    light: {
      primary: { main: "#147d64", dark: "#0d5d4a", contrastText: "#ffffff" },
      background: { default: "#f3f7f5", paper: "#ffffff" },
      text: { primary: "#17231f", secondary: "#5b6964" },
      divider: "#d9e4df",
      tableHead: "#f6f9f7",
      scrollbar: "#9aaba3",
      scrollbarHover: "#64766e",
    },
    dark: {
      primary: { main: "#51c7a6", dark: "#2ba685", contrastText: "#10201b" },
      background: { default: "#141816", paper: "#1c221f" },
      text: { primary: "#edf3f0", secondary: "#a7b5af" },
      divider: "#35413c",
      tableHead: "#202823",
      scrollbar: "#596760",
      scrollbarHover: "#82928b",
    },
  },
  {
    value: "indigo",
    label: "靛蓝",
    swatch: "#5366c7",
    light: {
      primary: { main: "#5366c7", dark: "#3e4ea7", contrastText: "#ffffff" },
      background: { default: "#f5f6fb", paper: "#ffffff" },
      text: { primary: "#1d2238", secondary: "#62687e" },
      divider: "#dfe2ef",
      tableHead: "#f8f8fc",
      scrollbar: "#a5abc4",
      scrollbarHover: "#747b9c",
    },
    dark: {
      primary: { main: "#a5b0ff", dark: "#6f7ef0", contrastText: "#131a3b" },
      background: { default: "#131520", paper: "#1b1e2b" },
      text: { primary: "#f0f1fa", secondary: "#adb1c6" },
      divider: "#383d52",
      tableHead: "#202433",
      scrollbar: "#60677e",
      scrollbarHover: "#898fa5",
    },
  },
  {
    value: "amber",
    label: "琥珀",
    swatch: "#b56b00",
    light: {
      primary: { main: "#b56b00", dark: "#8e5000", contrastText: "#ffffff" },
      background: { default: "#faf7f1", paper: "#ffffff" },
      text: { primary: "#2b2419", secondary: "#746858" },
      divider: "#e8dfd0",
      tableHead: "#fcfaf6",
      scrollbar: "#b9aa91",
      scrollbarHover: "#89775b",
    },
    dark: {
      primary: { main: "#f4bb62", dark: "#d99634", contrastText: "#2a1a00" },
      background: { default: "#1a1712", paper: "#241f18" },
      text: { primary: "#f5f0e8", secondary: "#beb2a0" },
      divider: "#494035",
      tableHead: "#29231b",
      scrollbar: "#716451",
      scrollbarHover: "#9b8b73",
    },
  },
  {
    value: "rose",
    label: "玫红",
    swatch: "#c84e72",
    light: {
      primary: { main: "#c84e72", dark: "#a53b5b", contrastText: "#ffffff" },
      background: { default: "#fbf5f7", paper: "#ffffff" },
      text: { primary: "#2d2025", secondary: "#766269" },
      divider: "#eadce1",
      tableHead: "#fcf8fa",
      scrollbar: "#bda4ad",
      scrollbarHover: "#8d707a",
    },
    dark: {
      primary: { main: "#f39ab0", dark: "#db708b", contrastText: "#3c101c" },
      background: { default: "#1a1417", paper: "#241c20" },
      text: { primary: "#f7eef1", secondary: "#c0adb4" },
      divider: "#4a3940",
      tableHead: "#2a2025",
      scrollbar: "#735d65",
      scrollbarHover: "#9d818b",
    },
  },
];

export function isThemeColor(value: unknown): value is ThemeColor {
  return THEME_COLOR_OPTIONS.some((option) => option.value === value);
}

export function getStoredThemeColor(): ThemeColor {
  const value = localStorage.getItem("netsentinel.themeColor");
  return isThemeColor(value) ? value : "sky";
}

export function setThemeColorPreference(value: ThemeColor) {
  localStorage.setItem("netsentinel.themeColor", value);
  window.dispatchEvent(new CustomEvent<ThemeColor>("netsentinel:theme-color", { detail: value }));
}

export const buildTheme = (mode: PaletteMode, color: ThemeColor = "sky") => {
  const colorOption = THEME_COLOR_OPTIONS.find((option) => option.value === color) ?? THEME_COLOR_OPTIONS[0];
  const tokens = colorOption[mode];
  const isLight = mode === "light";
  const surfaceShadow = isLight
    ? `0 18px 45px ${alpha(tokens.primary.dark, 0.08)}`
    : `0 20px 48px ${alpha("#000000", 0.24)}`;
  return createTheme({
    palette:
      mode === "light"
        ? {
            mode,
            primary: tokens.primary,
            secondary: { main: "#a06413" },
            error: { main: "#bd342f" },
            warning: { main: "#a96608" },
            success: { main: "#18794e" },
            background: tokens.background,
            text: tokens.text,
            divider: tokens.divider,
          }
        : {
            mode,
            primary: tokens.primary,
            secondary: { main: "#e4aa55" },
            error: { main: "#f07a72" },
            warning: { main: "#e6ae57" },
            success: { main: "#55c68a" },
            background: tokens.background,
            text: tokens.text,
            divider: tokens.divider,
          },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily:
        '"Aptos", "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", sans-serif',
      h1: {
        fontSize: "clamp(1.7rem, 1.2rem + 1.1vw, 2.35rem)",
        fontWeight: 760,
        letterSpacing: "-0.045em",
        lineHeight: 1.08,
      },
      h2: { fontSize: "1.08rem", fontWeight: 720, letterSpacing: "-0.018em", lineHeight: 1.25 },
      h3: { fontSize: "0.95rem", fontWeight: 700, letterSpacing: "-0.01em" },
      body2: { lineHeight: 1.55 },
      button: { textTransform: "none", fontWeight: 700, letterSpacing: "-0.01em" },
      allVariants: { letterSpacing: "-0.005em" },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            minHeight: 38,
            borderRadius: 9,
            transition: "transform 160ms ease, background-color 160ms ease, border-color 160ms ease",
            "&:hover": { transform: "translateY(-1px)" },
            "&:active": { transform: "translateY(0)" },
          },
          contained: {
            boxShadow: `0 8px 18px ${alpha(tokens.primary.dark, isLight ? 0.2 : 0.16)}`,
          },
          outlined: {
            borderColor: alpha(tokens.primary.main, isLight ? 0.28 : 0.46),
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 9,
            transition: "transform 160ms ease, background-color 160ms ease",
            "&:hover": { transform: "translateY(-1px)" },
            "&:active": { transform: "translateY(0)" },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
          outlined: {
            borderColor: alpha(tokens.divider, 0.9),
            boxShadow: `0 1px 0 ${alpha("#ffffff", isLight ? 0.74 : 0.03)} inset`,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            boxShadow: surfaceShadow,
            border: `1px solid ${alpha(tokens.divider, 0.78)}`,
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            fontWeight: 700,
            color: tokens.text.secondary,
            backgroundColor: tokens.tableHead,
            letterSpacing: "0.02em",
            fontSize: "0.73rem",
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 7,
            fontWeight: 700,
            letterSpacing: "0.01em",
          },
        },
      },
      MuiTextField: {
        defaultProps: { variant: "outlined" },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            transition: "box-shadow 160ms ease",
            "&.Mui-focused": {
              boxShadow: `0 0 0 3px ${alpha(tokens.primary.main, isLight ? 0.13 : 0.2)}`,
            },
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          html: { colorScheme: mode },
          body: {
            fontFeatureSettings: '"ss01" 1, "ss02" 1',
            fontVariantNumeric: "tabular-nums",
          },
          "*": {
            scrollbarWidth: "thin",
            scrollbarColor: `${tokens.scrollbar} transparent`,
          },
          "*::-webkit-scrollbar": { width: 10, height: 10 },
          "*::-webkit-scrollbar-track": { backgroundColor: "transparent" },
          "*::-webkit-scrollbar-thumb": {
            minHeight: 40,
            border: "2px solid transparent",
            borderRadius: 8,
            backgroundClip: "content-box",
            backgroundColor: tokens.scrollbar,
          },
          "*::-webkit-scrollbar-thumb:hover": {
            backgroundColor: tokens.scrollbarHover,
          },
          "*::-webkit-scrollbar-button": { display: "none", width: 0, height: 0 },
          "*::-webkit-scrollbar-corner": { backgroundColor: "transparent" },
        },
      },
    },
  });
};
