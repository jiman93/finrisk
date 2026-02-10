from enum import Enum


class GroupType(str, Enum):
    A = "A"
    B = "B"


class ModeType(str, Enum):
    baseline = "baseline"
    hitl_r = "hitl_r"
    hitl_g = "hitl_g"
    hitl_full = "hitl_full"


class CheckpointPipelinePosition(str, Enum):
    after_retrieval = "after_retrieval"
    after_generation = "after_generation"
    post_generation = "post_generation"


class CheckpointState(str, Enum):
    pending = "pending"
    offered = "offered"
    active = "active"
    submitted = "submitted"
    collapsed = "collapsed"
    skipped = "skipped"
    failed = "failed"
    timed_out = "timed_out"
