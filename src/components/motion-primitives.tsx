"use client";

import type { HTMLAttributes, ReactNode } from "react";
import type { Transition } from "motion/react";

const spring: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 28,
  mass: 0.6,
};

type FadeRiseProps = HTMLAttributes<HTMLDivElement> & {
  delay?: number;
  y?: number;
};

export function FadeRise({
  children,
  delay: _delay,
  y: _y,
  ...rest
}: FadeRiseProps) {
  void _delay;
  void _y;
  return <div {...rest}>{children}</div>;
}

type StaggerProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  staggerChildren?: number;
  delayChildren?: number;
};

export function Stagger({
  children,
  staggerChildren: _staggerChildren,
  delayChildren: _delayChildren,
  ...rest
}: StaggerProps) {
  void _staggerChildren;
  void _delayChildren;
  return <div {...rest}>{children}</div>;
}

export const motionSpring = spring;
