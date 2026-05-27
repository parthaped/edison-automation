"use client";

import { motion, type HTMLMotionProps, type Transition } from "motion/react";
import { Children, type ReactNode } from "react";

const spring: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 28,
  mass: 0.6,
};

type FadeRiseProps = Omit<HTMLMotionProps<"div">, "initial" | "animate"> & {
  delay?: number;
  y?: number;
};

export function FadeRise({
  children,
  delay = 0,
  y = 12,
  transition,
  ...rest
}: FadeRiseProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition ?? { ...spring, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

type StaggerProps = Omit<HTMLMotionProps<"div">, "initial" | "animate" | "variants"> & {
  children: ReactNode;
  staggerChildren?: number;
  delayChildren?: number;
};

export function Stagger({
  children,
  staggerChildren = 0.06,
  delayChildren = 0.04,
  ...rest
}: StaggerProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren, delayChildren },
        },
      }}
      {...rest}
    >
      {Children.map(children, (child) => (
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 12 },
            visible: { opacity: 1, y: 0, transition: spring },
          }}
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}

export const motionSpring = spring;
