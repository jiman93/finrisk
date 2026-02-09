from enum import Enum


class GroupType(str, Enum):
    A = "A"
    B = "B"


class ModeType(str, Enum):
    baseline = "baseline"
    hitl_r = "hitl_r"
    hitl_g = "hitl_g"
    hitl_full = "hitl_full"
