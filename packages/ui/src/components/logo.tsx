import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0H4V8H12V0H16V20H12V12H4V20H0Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0H20V40H60V0H80V100H60V60H20V100H0Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-wordmark"
      role="img"
      aria-label="Harpress"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      classList={{ [props.class ?? ""]: !!props.class }}
      fill="var(--icon-strong-base)"
    >
      <path d="M0 6H6V18H18V6H24V36H18V24H6V36H0Z" />
      <text x="38" y="33" font-size="34" font-weight="600" style={{ "font-family": "var(--font-family-sans)" }}>
        Harpress
      </text>
    </svg>
  )
}
