import type { FormEventHandler, ReactNode } from "react";
import { Box, Stack, Typography } from "@mui/material";
import { ShieldOutlined } from "@mui/icons-material";

export function AuthLayout({ title, onSubmit, children }: {
  title: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}) {
  return <Box
    component="main"
    data-testid="auth-layout"
    sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", px: 3, py: 5, bgcolor: "background.default" }}
  >
    <Box
      component="form"
      data-testid="auth-form"
      onSubmit={onSubmit}
      sx={{ width: "100%", maxWidth: 448, p: { xs: 2.5, sm: 4 }, bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 3 }}
    >
      <Stack direction="row" justifyContent="center" alignItems="center" gap={1.25} sx={{ mb: 2 }}>
        <Box sx={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 2, bgcolor: "primary.main", color: "primary.contrastText" }}>
          <ShieldOutlined />
        </Box>
        <Typography fontSize={26} fontWeight={800} letterSpacing="-0.04em">NetSentinel</Typography>
      </Stack>
      <Typography component="h1" variant="body1" textAlign="center" color="text.secondary" sx={{ mb: 4 }}>{title}</Typography>
      <Stack gap={3}>{children}</Stack>
    </Box>
  </Box>;
}
